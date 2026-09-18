export interface Theme {
  key: string;
  label: string;
  /** Used verbatim as the Jev Choice criterion and (M3b) as Claude prompt input. */
  description: string;
}

/** Order is significant: it is the final tie-break in theme rotation. */
export const THEMES: readonly Theme[] = [
  { key: "work", label: "Work & careers", description: "Jobs, professions, workplaces, colleagues, hiring, meetings, tasks and office life. Not money or companies as such (business) and not school (education)." },
  { key: "business", label: "Business & money", description: "Money, prices, banking, trade, companies, economy, finance, marketing and ownership. Not the daily activity of doing a job (work) and not buying personal goods (shopping)." },
  { key: "technology", label: "Technology & internet", description: "Computers, software, devices, the internet, data, machines, engineering and digital tools. Not pure science or research (science)." },
  { key: "science", label: "Science & research", description: "Scientific fields, experiments, theories, mathematics, physics, chemistry, space and research methods. Not practical devices or software (technology) and not medicine (health)." },
  { key: "education", label: "Education & learning", description: "Schools, universities, studying, teaching, exams, subjects, classroom objects and academic skills." },
  { key: "health", label: "Health & medicine", description: "Illness, injuries, treatment, doctors, hospitals, medicines, mental health and healthy habits. Not plain body parts or looks (body)." },
  { key: "body", label: "Body & appearance", description: "Parts of the body, physical appearance, looks, physical actions and the senses. Not illness or treatment (health) and not clothes (shopping)." },
  { key: "food", label: "Food & drink", description: "Food, drinks, ingredients, cooking, meals, taste, restaurants and kitchen tools." },
  { key: "home", label: "Home & daily life", description: "Houses, rooms, furniture, household objects, chores and everyday routines at home. Not the city or public places (city)." },
  { key: "family", label: "Family & relationships", description: "Family members, friends, partners, marriage, social relationships and life stages such as birth and childhood." },
  { key: "feelings", label: "Feelings & personality", description: "Emotions, moods, character traits, attitudes, opinions and mental states of a person." },
  { key: "travel", label: "Travel & transport", description: "Journeys, holidays, tourism, hotels, vehicles, roads, airports, directions and ways of getting around." },
  { key: "city", label: "City & places", description: "Towns, buildings, streets, public places, countries, regions and geographical locations where people live. Not wild nature (nature) and not the act of travelling (travel)." },
  { key: "nature", label: "Nature & environment", description: "Weather, climate, landscapes, seas, mountains, natural materials, natural disasters and environmental issues. Not living creatures or plants (animals)." },
  { key: "animals", label: "Animals & plants", description: "Animals, birds, fish, insects, pets, farm animals, trees, flowers and other plants." },
  { key: "sports", label: "Sports & fitness", description: "Sports, games played physically, exercise, competitions, players, teams, scores and sports equipment." },
  { key: "entertainment", label: "Entertainment & media", description: "Films, television, music, video games, hobbies, parties, celebrities, news media and having fun. Not fine art or literature (arts)." },
  { key: "arts", label: "Arts & culture", description: "Painting, literature, theatre, museums, design, history, religion, traditions and cultural heritage. Not popular films, pop music or games (entertainment)." },
  { key: "shopping", label: "Shopping & clothes", description: "Shops, buying personal goods, clothes, shoes, accessories, fashion, sizes and colours of clothing." },
  { key: "society", label: "Society, law & politics", description: "Government, politics, law, crime, police, war, rights, social problems, institutions and public affairs." },
  { key: "communication", label: "Communication & language", description: "Speaking, writing, languages, grammar terms, messages, phone calls, letters, conversation and ways of expressing or reporting something." },
];

/** Not a lesson theme — the bucket for words with no clear theme. Never rotated. */
export const GENERAL_TOPIC = "general";

export const GENERAL_DESCRIPTION =
  "No specific theme: function words (articles, pronouns, prepositions, conjunctions), very general verbs, adjectives and adverbs usable in any context, numbers, quantities, time, dates and measurement.";

export const THEME_KEYS: ReadonlySet<string> = new Set(THEMES.map((t) => t.key));

export function isTopicKey(k: string): boolean {
  return k === GENERAL_TOPIC || THEME_KEYS.has(k);
}

export function themeByKey(key: string): Theme | undefined {
  return THEMES.find((t) => t.key === key);
}
