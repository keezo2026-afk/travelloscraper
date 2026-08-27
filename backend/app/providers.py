"""Modular search providers. Credentials stay on the server."""
from __future__ import annotations

import json
import os
from typing import Any

import httpx


RETRYABLE_STATUSES = {408, 429}


class SearchError(Exception):
    def __init__(self, message: str, retryable: bool = True, status: int | None = None, reason: str | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.status = status
        self.reason = reason


def _compact(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()[:300]


def _error_details(payload: Any, raw: str = "") -> str:
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, str):
            return _compact(error)
        if isinstance(error, dict):
            reasons = [item.get("reason") for item in (error.get("errors") or []) if isinstance(item, dict)]
            values = [*reasons, error.get("status"), error.get("message")]
            unique = []
            for value in values:
                value = _compact(value)
                if value and value not in unique:
                    unique.append(value)
            return " — ".join(unique)
        return _compact(payload.get("message"))
    return _compact(raw)


def _provider_error(name: str, status: int, payload: Any = None, raw: str = "") -> SearchError:
    detail = _error_details(payload, raw)
    message = f"{name} error {status}"
    if detail:
        message += f": {detail}"
    return SearchError(
        message,
        retryable=status in RETRYABLE_STATUSES or status >= 500,
        status=status,
        reason=detail or None,
    )


def _response_error(name: str, response: httpx.Response) -> SearchError:
    raw = response.text
    payload = None
    try:
        payload = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        pass
    return _provider_error(name, response.status_code, payload, raw)


class BaseProvider:
    name = "base"

    def configured(self) -> bool:
        return False

    def search(self, query: str, num: int = 10) -> list[dict[str, Any]]:
        raise NotImplementedError


class SerpApiProvider(BaseProvider):
    name = "serpapi"

    def configured(self) -> bool:
        return bool(os.getenv("SEARCH_API_KEY"))

    def search(self, query: str, num: int = 10) -> list[dict[str, Any]]:
        key = os.getenv("SEARCH_API_KEY")
        if not key:
            raise SearchError("SEARCH_API_KEY is not set for SerpAPI", retryable=False)
        params = {
            "engine": "google",
            "q": query,
            "api_key": key,
            "num": min(num, 20),
            "gl": "za",
            "hl": "en",
        }
        with httpx.Client(timeout=30) as client:
            r = client.get("https://serpapi.com/search.json", params=params)
        if r.status_code >= 400:
            raise _response_error("SerpAPI", r)
        data = r.json()
        if data.get("error"):
            raise _provider_error("SerpAPI", 400, data)
        out = []
        for i, item in enumerate(data.get("organic_results") or [], start=1):
            out.append({
                "title": item.get("title") or "",
                "url": item.get("link") or "",
                "snippet": item.get("snippet") or "",
                "position": item.get("position") or i,
            })
        return out


class GoogleCseProvider(BaseProvider):
    name = "google_cse"

    def configured(self) -> bool:
        return bool(os.getenv("SEARCH_API_KEY") and os.getenv("GOOGLE_CSE_ID"))

    def search(self, query: str, num: int = 10) -> list[dict[str, Any]]:
        key = os.getenv("SEARCH_API_KEY")
        cx = os.getenv("GOOGLE_CSE_ID")
        if not key or not cx:
            raise SearchError("SEARCH_API_KEY and GOOGLE_CSE_ID required", retryable=False)
        params = {"key": key, "cx": cx, "q": query, "num": min(num, 10), "gl": "za"}
        with httpx.Client(timeout=30) as client:
            r = client.get("https://www.googleapis.com/customsearch/v1", params=params)
        if r.status_code >= 400:
            raise _response_error("Google CSE", r)
        data = r.json()
        out = []
        for i, item in enumerate(data.get("items") or [], start=1):
            out.append({
                "title": item.get("title") or "",
                "url": item.get("link") or "",
                "snippet": item.get("snippet") or "",
                "position": i,
            })
        return out


class BraveProvider(BaseProvider):
    name = "brave"

    def configured(self) -> bool:
        return bool(os.getenv("BRAVE_API_KEY") or os.getenv("SEARCH_API_KEY"))

    def search(self, query: str, num: int = 10) -> list[dict[str, Any]]:
        key = os.getenv("BRAVE_API_KEY") or os.getenv("SEARCH_API_KEY")
        if not key:
            raise SearchError("BRAVE_API_KEY is not set", retryable=False)
        headers = {"Accept": "application/json", "X-Subscription-Token": key}
        params = {"q": query, "count": min(num, 20), "country": "ZA"}
        with httpx.Client(timeout=30) as client:
            r = client.get("https://api.search.brave.com/res/v1/web/search", params=params, headers=headers)
        if r.status_code >= 400:
            raise _response_error("Brave", r)
        data = r.json()
        out = []
        for i, item in enumerate((data.get("web") or {}).get("results") or [], start=1):
            out.append({
                "title": item.get("title") or "",
                "url": item.get("url") or "",
                "snippet": item.get("description") or "",
                "position": i,
            })
        return out


class BingProvider(BaseProvider):
    name = "bing"

    def configured(self) -> bool:
        return bool(os.getenv("BING_API_KEY") or os.getenv("SEARCH_API_KEY"))

    def search(self, query: str, num: int = 10) -> list[dict[str, Any]]:
        key = os.getenv("BING_API_KEY") or os.getenv("SEARCH_API_KEY")
        if not key:
            raise SearchError("BING_API_KEY is not set", retryable=False)
        headers = {"Ocp-Apim-Subscription-Key": key}
        params = {"q": query, "count": min(num, 50), "mkt": "en-ZA"}
        with httpx.Client(timeout=30) as client:
            r = client.get("https://api.bing.microsoft.com/v7.0/search", params=params, headers=headers)
        if r.status_code >= 400:
            raise _response_error("Bing", r)
        data = r.json()
        out = []
        for i, item in enumerate((data.get("webPages") or {}).get("value") or [], start=1):
            out.append({
                "title": item.get("name") or "",
                "url": item.get("url") or "",
                "snippet": item.get("snippet") or "",
                "position": i,
            })
        return out


PROVIDERS = {
    "serpapi": SerpApiProvider,
    "google_cse": GoogleCseProvider,
    "brave": BraveProvider,
    "bing": BingProvider,
}


def get_provider(name: str | None = None) -> BaseProvider:
    name = (name or os.getenv("SEARCH_PROVIDER") or "serpapi").lower()
    cls = PROVIDERS.get(name)
    if not cls:
        raise SearchError(f"Unknown provider {name}", retryable=False)
    return cls()


def provider_status() -> dict:
    current = (os.getenv("SEARCH_PROVIDER") or "serpapi").lower()
    return {
        "current": current,
        "providers": {
            k: {"configured": cls().configured()}
            for k, cls in PROVIDERS.items()
        },
    }
