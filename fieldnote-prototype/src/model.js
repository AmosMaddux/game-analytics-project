export const hasValue=m=>m?.value!==null&&m?.value!==undefined&&Number.isFinite(Number(m.value));
export const number=m=>hasValue(m)?Number(m.value).toLocaleString('en-US'):'Not captured';
export function selectGames(games,{query='',genre='',cohort='',sort='players',direction='desc',tag=''}={}){let result=games.filter(g=>(!genre||g.genre===genre)&&(!cohort||g.cohort===cohort)&&(!tag||g.tags?.includes(tag))&&(!query||[g.name,g.steamName,g.genre,...(g.tags||[])].join(' ').toLowerCase().includes(query.toLowerCase())));return result.sort((a,b)=>{if(['players','reviews'].includes(sort)){const av=hasValue(a[sort]),bv=hasValue(b[sort]);if(av!==bv)return av?-1:1;if(av){const delta=Number(a[sort].value)-Number(b[sort].value);if(delta)return direction==='asc'?delta:-delta;}}else if(sort==='name'){return a.name.localeCompare(b.name)*(direction==='asc'?1:-1)}return a.name.localeCompare(b.name)});}
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}

export const POPULARITY_SCORE_METHOD = Object.freeze({version: '1.0', meanWeight: 0.30, medianWeight: 0.70});

// A deliberately narrow, versioned editorial classification of exact saved Steam
// tags. These rules do not validate the tags or infer unrecorded game features.
export const GENRE_TAG_METHOD = Object.freeze({
  version: '1.0',
  minimumGameCount: 2,
  denominator: 'All unique games in the selected genre with at least one nonempty saved tag',
  matching: 'Exact saved tag text; no aliases, case folding or inferred features',
  order: 'Game count descending, then tag alphabetically in English',
  mechanicTags: Object.freeze([
    'Base Building', 'Building', 'Character Customization', 'Choices Matter', 'Combat',
    'Cooking', 'Crafting', 'Deckbuilding', 'Diplomacy', 'Dynamic Narration', 'Economy',
    'Exploration', 'Farming', 'Fishing', 'Grid-Based Movement', 'Inventory Management',
    'Investigation', 'Logic', 'Management', 'Mining',
    'Multiple Endings', 'Procedural Generation', 'Programming', 'Resource Management',
    'Sailing', 'Turn-Based', 'Turn-Based Combat',
  ]),
  themeTags: Object.freeze([
    '1980s', "1990's", 'Agriculture', 'Aliens', 'Alternate History', 'Conspiracy',
    'Cyberpunk', 'Dark Fantasy', 'Demons', 'Detective', 'Dogs', 'Dystopian', 'Fantasy',
    'Female Protagonist', 'Historical', 'LGBTQ+', 'Lovecraftian', 'Magic', 'Medieval',
    'Mystery', 'Nature', 'Post-apocalyptic', 'Psychological', 'Robots', 'Romance',
    'Sci-fi', 'Space', 'Supernatural', 'Surreal', 'Trains',
  ]),
});

export function classifyGenreTag(tag) {
  if (GENRE_TAG_METHOD.mechanicTags.includes(tag)) return 'mechanic';
  if (GENRE_TAG_METHOD.themeTags.includes(tag)) return 'theme';
  return null;
}

// Always pass the full snapshot, independently of the game-list search/filter.
// Each saved game contributes at most once to a tag. Repeated rows with the same
// saved ID are merged without changing their source tags or input objects.
export function summarizeGenreTags(games, genre, limit = 5) {
  const members = new Map();
  for (const game of Array.isArray(games) ? games : []) {
    if (!game || game.genre !== genre) continue;
    const id = game.id ?? game.appid;
    const key = id === null || id === undefined || id === '' ? game : `id:${id}`;
    if (!members.has(key)) members.set(key, new Set());
    const tags = members.get(key);
    for (const tag of Array.isArray(game.tags) ? game.tags : []) {
      if (typeof tag === 'string' && tag.trim()) tags.add(tag);
    }
  }

  let taggedGameCount = 0;
  let matchingGameCount = 0;
  const counts = new Map();
  for (const savedTags of members.values()) {
    if (savedTags.size) taggedGameCount++;
    let matched = false;
    for (const tag of savedTags) {
      const type = classifyGenreTag(tag);
      if (!type) continue;
      matched = true;
      if (!counts.has(tag)) counts.set(tag, {tag, type, count: 0});
      counts.get(tag).count++;
    }
    if (matched) matchingGameCount++;
  }

  const recurringTags = [...counts.values()]
    .filter(({count}) => count >= GENRE_TAG_METHOD.minimumGameCount)
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'en'));
  const resultLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 5;
  return {
    genre,
    gameCount: members.size,
    taggedGameCount,
    matchingGameCount,
    classifiedTagCount: counts.size,
    recurringTagCount: recurringTags.length,
    tags: recurringTags.slice(0, resultLimit).map(row => ({
      ...row,
      percentage: 100 * row.count / taggedGameCount,
    })),
  };
}

// Score the complete genre population before applying any display/search filters.
// This is a provisional relative engagement heuristic, not calibrated popularity.
export function scoreGenreRows(rows) {
  const {meanWeight, medianWeight} = POPULARITY_SCORE_METHOD;
  const scored = rows.map(row => {
    const supported = row.observedCount > 0 && [row.average, row.median].every(value =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0);
    const signal = supported ? meanWeight * Math.log1p(row.average) + medianWeight * Math.log1p(row.median) : null;
    return {...row, signal};
  });
  const maximum = scored.reduce((max, row) => row.signal === null ? max : Math.max(max, row.signal), 0);
  return scored.map(row => ({...row, popularityScore: row.signal === null ? null : maximum === 0 ? 0 :
    Math.min(100, Math.max(0, 100 * (row.signal / maximum)))})).sort((a, b) => {
    if ((a.popularityScore === null) !== (b.popularityScore === null)) return a.popularityScore === null ? 1 : -1;
    return (b.popularityScore ?? 0) - (a.popularityScore ?? 0) || a.genre.localeCompare(b.genre);
  });
}

// Averages and medians describe only supported observations in the complete snapshot.
// Missing observations never contribute an invented zero, denominator or date bound.
// Pass the full snapshot here; filter the returned rows so the baseline stays global.
export function rankGenres(games, genres) {
  const rows = genres.map(genre => {
    const members = games.filter(game => game.genre === genre);
    let total = null;
    const values = [];
    let observedStart = null;
    let observedEnd = null;
    let startTime = Infinity;
    let endTime = -Infinity;

    for (const game of members) {
      const metric = game.players;
      if (typeof metric?.value !== 'number' || !Number.isFinite(metric.value) ||
          metric.value < 0 || metric.status !== 'observed' || metric.scoreEligible === false || !safeUrl(metric.sourceUrl) ||
          typeof metric.observedAt !== 'string') continue;
      const observedTime = Date.parse(metric.observedAt);
      if (!Number.isFinite(observedTime)) continue;

      total = (total ?? 0) + metric.value;
      values.push(metric.value);
      if (observedTime < startTime) {
        startTime = observedTime;
        observedStart = metric.observedAt;
      }
      if (observedTime > endTime) {
        endTime = observedTime;
        observedEnd = metric.observedAt;
      }
    }

    values.sort((a, b) => a - b);
    const observedCount = values.length;
    const average = observedCount ? Number.isFinite(total) ? total / observedCount :
      values.reduce((mean, value, index) => mean + (value - mean) / (index + 1), 0) : null;
    const middle = Math.floor(observedCount / 2);
    const median = !observedCount ? null : observedCount % 2 ? values[middle] :
      values[middle - 1] + (values[middle] - values[middle - 1]) / 2;

    return {genre, average, median, total, observedCount, gameCount: members.length, observedStart, observedEnd};
  });

  return scoreGenreRows(rows);
}
