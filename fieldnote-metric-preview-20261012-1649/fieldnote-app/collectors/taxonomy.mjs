/** User-approved editorial groupings, never a substitute for Steam's observed tags. */
export const TAXONOMY_VERSION = 'editorial-expanded-1.1';
export const TAXONOMY_STATUS = 'user_approved_2026-10-10';
export const UNRESOLVED_GENRE = 'Unresolved / needs review';
export const GENRES = Object.freeze([
  'Colony / settlement simulation', 'Cozy building toy', 'Farming / life simulation',
  'Horror / exploration', 'Platformer / metroidvania', 'Puzzle', 'Roguelike deckbuilder',
  'Role-playing', 'Shooter', 'Strategy', 'Survival / crafting', 'Racing / sports',
]);

// Each outer group is required; alternatives within a group are ORed. These
// documented IGDB genre/theme IDs are used as references, not Steam tag IDs.
const rule = (field, ids = [], names = []) => Object.freeze({ field, ids: Object.freeze(ids), names: Object.freeze(names) });
const route = (id, genreIndex, groups) => Object.freeze({ id, genre: GENRES[genreIndex], groups: Object.freeze(groups.map(group => Object.freeze(group))) });
export const DISCOVERY_ROUTES = Object.freeze([
  route('colony', 0, [[rule('keywords', [], ['colony simulation', 'colony sim', 'colony management', 'colony building', 'settlement building', 'settlement management', 'city building', 'city builder', 'city-building'])]]),
  route('cozy', 1, [
    [rule('keywords', [], ['building', 'construction', 'building simulation', 'sandbox building', 'city building', 'city builder']), rule('themes', [23], ['sandbox'])],
    [rule('keywords', [], ['cozy', 'cosy', 'relaxing', 'wholesome', 'cozy game', 'relaxing gameplay'])],
  ]),
  route('farming', 2, [[rule('keywords', [], ['farming', 'farming simulation', 'farming simulator', 'farming sim', 'agriculture', 'life simulation', 'life simulator', 'life sim'])]]),
  route('horror', 3, [[rule('themes', [19], ['horror']), rule('keywords', [], ['horror', 'survival horror'])]]),
  route('platformer', 4, [[rule('genres', [8], ['platform', 'platformer']), rule('keywords', [], ['metroidvania'])]]),
  route('puzzle', 5, [[rule('genres', [9], ['puzzle'])]]),
  route('deckbuilder', 6, [
    [rule('keywords', [], ['deck building', 'deck-building', 'deckbuilder', 'deck builder', 'deckbuilding'])],
    [rule('keywords', [], ['roguelike', 'rogue-like', 'roguelite', 'rogue-lite', 'roguelike deckbuilder'])],
  ]),
  route('role_playing', 7, [[rule('genres', [12], ['role-playing (rpg)', 'role-playing', 'role playing', 'rpg'])]]),
  route('shooter', 8, [[rule('genres', [5], ['shooter'])]]),
  route('strategy', 9, [[rule('genres', [11, 15, 16, 24], ['real time strategy (rts)', 'strategy', 'turn-based strategy (tbs)', 'tactical'])]]),
  route('survival', 10, [[rule('themes', [21], ['survival']), rule('keywords', [], ['survival', 'survival crafting', 'survival-crafting'])]]),
  route('racing_sports', 11, [[rule('genres', [10, 14], ['racing', 'sport', 'sports'])]]),
]);

export function normalizeLabelKey(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

export function discoveryRoute(id) {
  const result = DISCOVERY_ROUTES.find(item => item.id === id);
  if (!result) throw new TypeError('Unknown editorial discovery route');
  return result;
}

/** Build only allowlisted provider expressions; no caller text enters a query. */
export function routeFilter(id) {
  return discoveryRoute(id).groups.map(group => `(${group.flatMap(item => [
    ...(item.ids.length ? [`${item.field} = (${item.ids.join(',')})`] : []),
    ...(item.names.length ? [`${item.field}.name = (${item.names.map(name => JSON.stringify(name)).join(',')})`] : []),
  ]).join(' | ')})`).join(' & ');
}

function matchingLabels(raw, item) {
  const rows = Array.isArray(raw?.[item.field]) ? raw[item.field] : [];
  return rows.filter(value => value && Number.isSafeInteger(value.id) && value.id > 0 && typeof value.name === 'string'
    && (item.ids.includes(value.id) || item.names.includes(normalizeLabelKey(value.name))))
    .map(value => ({ sourceField: item.field, id: value.id, name: value.name }));
}

/**
 * Source labels remain independently available in catalog.genres/themes/keywords.
 * Original editorial groups supplied by the caller always win. Discovery routes
 * never select the primary group. A previous mapping may be retained only while
 * supported by the strongest evidence tier; equally strong alternatives remain
 * explicit. No game name, Steam tag, popularity metric or array order is a rule.
 */
export function mapEditorialGenre(raw, { preservedGenre = null, preferredRouteId = null, previousMapping = null } = {}) {
  if (preservedGenre !== null && !GENRES.includes(preservedGenre)) throw new TypeError('Unknown preserved editorial genre');
  if (preferredRouteId !== null) discoveryRoute(preferredRouteId);
  if (previousMapping !== null && (!previousMapping || typeof previousMapping !== 'object' || Array.isArray(previousMapping)
    || typeof previousMapping.version !== 'string' || previousMapping.version.length > 64
    || (previousMapping.genre !== null && !GENRES.includes(previousMapping.genre))
    || (previousMapping.routeId !== null && !DISCOVERY_ROUTES.some(item => item.id === previousMapping.routeId)))) throw new TypeError('Invalid previous editorial mapping');
  const has = (field, ids, names) => matchingLabels(raw, rule(field, ids, names)).length > 0;
  const simulator = has('genres', [13], ['simulator', 'simulation']);
  const survivalTheme = has('themes', [21], ['survival']);
  const specificSimulation = has('keywords', [], ['farming simulation', 'farming simulator', 'farming sim', 'life simulation', 'life simulator', 'life sim']);
  const matches = DISCOVERY_ROUTES.flatMap(item => {
    const groups = item.groups.map(group => group.flatMap(part => matchingLabels(raw, part)));
    if (groups.some(group => group.length === 0)) return [];
    // Incidental farming is common in RPGs and survival sandboxes. A generic
    // farming/agriculture keyword is insufficient without Simulator evidence,
    // and never establishes this group in the presence of a Survival theme.
    if (item.id === 'farming' && !specificSimulation && (!simulator || survivalTheme)) return [];
    const evidence = [...new Map(groups.flat().map(value => [`${value.sourceField}:${value.id}`, value])).values()];
    let evidenceTier = 2; let evidenceRule = 'direct_or_correlated_source_labels';
    if (['farming', 'cozy'].includes(item.id) && survivalTheme) {
      evidenceTier = 1; evidenceRule = 'simulation_or_cozy_keywords_subordinate_to_explicit_survival_theme';
    } else if (item.id === 'farming' && !simulator) {
      evidenceTier = 1; evidenceRule = 'simulation_keyword_without_simulator_genre';
    }
    return [{ routeId: item.id, genre: item.genre, evidence, evidenceTier, evidenceRule }];
  });
  const strongestTier = Math.max(0, ...matches.map(item => item.evidenceTier));
  const strongest = matches.filter(item => item.evidenceTier === strongestTier);
  const previous = previousMapping ? strongest.find(item => item.routeId === previousMapping.routeId && item.genre === previousMapping.genre) : null;
  const explicitSurvival = survivalTheme ? strongest.find(item => item.routeId === 'survival') : null;
  const chosen = previous ?? explicitSurvival ?? (strongest.length === 1 ? strongest[0] : null);
  const unresolved = !chosen && strongest.length > 1;
  const prior = previousMapping === null ? null : {
    version: previousMapping.version, genre: previousMapping.genre, routeId: previousMapping.routeId,
    method: typeof previousMapping.method === 'string' && previousMapping.method.length <= 80 ? previousMapping.method : null,
  };
  return {
    version: TAXONOMY_VERSION, status: TAXONOMY_STATUS,
    genre: preservedGenre ?? chosen?.genre ?? null,
    routeId: preservedGenre === null ? chosen?.routeId ?? null : DISCOVERY_ROUTES.find(item => item.genre === preservedGenre).id,
    method: preservedGenre !== null ? 'preserved_editorial_mapping' : chosen ? 'explicit_igdb_evidence_tier_rule' : unresolved ? 'unresolved_source_label_ambiguity' : 'unmapped',
    selectionRule: preservedGenre !== null ? 'preserved_original_group' : previous ? 'retained_supported_previous_mapping'
      : explicitSurvival ? 'explicit_survival_theme_after_prior_mapping_invalidated_or_absent'
        : chosen ? 'unique_strongest_evidence' : unresolved ? 'unresolved_equal_strength_labels' : 'no_supported_group',
    discoveryRouteId: preferredRouteId, previousMapping: prior, matches,
    ambiguity: { status: unresolved && preservedGenre === null ? 'unresolved_primary' : matches.length > 1 ? 'multiple_supported_labels' : 'none',
      alternatives: matches.filter(item => item.genre !== (preservedGenre ?? chosen?.genre)).map(item => item.genre) },
    note: 'Provisional editorial inference from IGDB source labels, with explicit evidence tiers and retained alternatives. Not an observed Steam tag or objective exclusive genre truth.',
  };
}

export function genreCoverage(candidates, { minimum = 15 } = {}) {
  if (!Number.isSafeInteger(minimum) || minimum < 1) throw new TypeError('Invalid coverage minimum');
  return GENRES.map(genre => {
    const count = candidates.filter(item => item.genre === genre).length;
    return { genre, count, minimum, status: count >= minimum ? 'minimum_met' : 'under_minimum' };
  });
}
