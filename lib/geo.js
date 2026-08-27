export const PROVINCES = [
  "Gauteng", "KwaZulu-Natal", "Western Cape", "Eastern Cape", "Mpumalanga",
  "Limpopo", "North West", "Free State", "Northern Cape",
];

export const CITIES = {
  Gauteng: ["Johannesburg", "Pretoria", "Sandton", "Midrand", "Centurion", "Soweto", "Roodepoort", "Kempton Park", "Benoni", "Boksburg"],
  "KwaZulu-Natal": ["Durban", "Umhlanga", "Ballito", "Pietermaritzburg", "Richards Bay", "Margate", "Port Shepstone", "St Lucia", "Hluhluwe", "Drakensberg"],
  "Western Cape": ["Cape Town", "Stellenbosch", "Paarl", "George", "Knysna", "Plettenberg Bay", "Mossel Bay", "Hermanus", "Franschhoek", "Oudtshoorn"],
  "Eastern Cape": ["Gqeberha", "East London", "Mthatha", "Jeffreys Bay", "Port Alfred", "Hogsback"],
  Mpumalanga: ["Mbombela", "Hazyview", "White River", "Sabie", "Graskop", "Komatipoort"],
  Limpopo: ["Polokwane", "Hoedspruit", "Tzaneen", "Phalaborwa", "Bela-Bela", "Thohoyandou"],
  "North West": ["Rustenburg", "Hartbeespoort", "Sun City", "Mahikeng"],
  "Free State": ["Bloemfontein", "Clarens", "Bethlehem", "Welkom"],
  "Northern Cape": ["Kimberley", "Upington", "Springbok", "Augrabies"],
};

export const INDUSTRIES = [
  "Travel Agency", "Tour Operator", "Safari", "Tourism", "Adventure Travel",
  "Holiday Company", "Destination Management", "Travel Consultant", "Excursion",
  "Experience", "Boat Tour", "Cruise Tour", "Wildlife Tour", "Fishing Charter",
  "Hiking Tour", "Airport Transfer", "Cultural Tour", "Wine Tour", "City Tour",
  "Backpacker Tour", "Luxury Travel",
];

export const KEYWORD_EXPANSIONS = {
  "Travel Agency": ["travel agent", "travel agency", "travel consultant", "holiday planner", "holiday travel", "travel company", "travel services"],
  "Tour Operator": ["tour operator", "tour company", "tourism company", "guided tours"],
  Safari: ["safari", "safari tours", "safari operator", "safari company", "wildlife tours", "game drives", "African safari"],
  Tourism: ["tourism", "tourist company", "visitor tours"],
  "Adventure Travel": ["adventure tours", "adventure travel", "adventure company"],
};

export const DEFAULT_TEMPLATES = [
  '"{keyword}" "{location}" Facebook',
  '"{keyword}" "{location}" tourism Facebook',
  '"{keyword}" "{location}" travel Facebook',
  '"{keyword}" "{location}" tour Facebook',
  '"{keyword}" "{location}" safari Facebook',
];

export const DEFAULT_EXCLUSIONS = ["jobs", "careers", "vacancies", "employment", "reviews"];

export const CATEGORY_KEYWORDS = {
  "Travel Agency": ["travel agency", "travel agent", "travel consultant"],
  "Tour Operator": ["tour operator", "tour company", "guided tour"],
  Safari: ["safari", "game drive", "wildlife"],
  Tourism: ["tourism", "tourist"],
  Adventure: ["adventure", "adrenaline"],
  Accommodation: ["accommodation", "guest house", "bnb"],
  Hotel: ["hotel"],
  Lodge: ["lodge"],
  Experience: ["experience"],
  Excursion: ["excursion", "day trip"],
  "Boat Tour": ["boat tour", "cruise", "whale"],
  Fishing: ["fishing", "charter"],
  Hiking: ["hiking", "trek"],
  "Cultural Tourism": ["cultural", "heritage"],
  "Wine Tour": ["wine tour", "wine tasting"],
  "City Tour": ["city tour", "city sightseeing"],
  "Airport Transfer": ["airport transfer", "shuttle"],
};

export const SEARCH_PRESETS = {
  "SOUTH AFRICA — ALL TRAVEL": { industries: INDUSTRIES.slice(0, 5), provinces: PROVINCES, cities: [], templates: DEFAULT_TEMPLATES.slice(0, 3) },
  "SOUTH AFRICA — TOUR OPERATORS": { industries: ["Tour Operator"], provinces: PROVINCES, cities: [], templates: ['"{keyword}" "{location}" Facebook'] },
  "SOUTH AFRICA — SAFARI": { industries: ["Safari"], provinces: ["Mpumalanga", "Limpopo", "KwaZulu-Natal", "Northern Cape"], cities: [], templates: ['"{keyword}" "{location}" Facebook', '"{keyword}" "{location}" safari Facebook'] },
  "KZN — TRAVEL": { industries: ["Travel Agency", "Tour Operator"], provinces: ["KwaZulu-Natal"], cities: CITIES["KwaZulu-Natal"], templates: DEFAULT_TEMPLATES.slice(0, 2) },
  "CAPE TOWN — TOURISM": { industries: ["Tourism", "City Tour", "Wine Tour"], provinces: ["Western Cape"], cities: ["Cape Town", "Stellenbosch", "Franschhoek"], templates: DEFAULT_TEMPLATES.slice(0, 3) },
  "GAUTENG — TRAVEL": { industries: ["Travel Agency", "Tour Operator"], provinces: ["Gauteng"], cities: CITIES.Gauteng, templates: DEFAULT_TEMPLATES.slice(0, 2) },
};
