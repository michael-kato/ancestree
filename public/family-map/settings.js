const levelOptions = new Set(['1', '2', '3', '4', 'unlimited']);

export function readMapSettings(href, people, defaults) {
  const params = new URL(href).searchParams;
  const person = params.get('person');
  const levels = params.get('levels');
  return {
    person: people.has(person) ? person : defaults.person,
    levels: levelOptions.has(levels) ? levels : defaults.levels,
  };
}

export function mapSettingsUrl(href, { person, levels }) {
  const url = new URL(href);
  url.searchParams.set('person', person);
  url.searchParams.set('levels', levels);
  return url;
}
