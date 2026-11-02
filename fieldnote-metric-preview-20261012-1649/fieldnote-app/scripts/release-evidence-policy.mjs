/** Reviewed public-source associations from RELEASE-EVIDENCE-AUDIT.md.
 * This is a bounded offline policy, not permission for automated collection.
 * Adding a host, claim role or verification method requires a new policy review.
 */
export const EVIDENCE_POLICY_VERSION = 'reviewed-steam-release-pilot-v1';
export const FIRST_PLAYABLE_POLICY = 'same-steam-appid-public-ea-release-v1';
export const SOURCES = Object.freeze({
  'mistria-steam': { appid: 2142790, kind: 'steam_store', url: 'https://store.steampowered.com/app/2142790/Fields_of_Mistria/?l=english', roles: ['steam_ea_date','steam_display_date','current_state','manual_base_game_review'] },
  'mistria-ea': { appid: 2142790, kind: 'developer', url: 'https://www.fieldsofmistria.com/post/fields-of-mistria-early-access-roadmap-have-arrived', roles: ['ea_available'] },
  'mistria-plan': { appid: 2142790, kind: 'developer', url: 'https://www.fieldsofmistria.com/post/fields-of-mistria-1-0-release-date-announcement', roles: ['planned_full_release'] },
  'mistria-full': { appid: 2142790, kind: 'developer', url: 'https://www.fieldsofmistria.com/post/fields-of-mistria-s-1-0-update-patch-notes-are-here', roles: ['full_release_available'] },
  'storm-steam': { appid: 1336490, kind: 'steam_store', url: 'https://store.steampowered.com/app/1336490/Against_the_Storm/', roles: ['steam_ea_date','steam_display_date','current_state','manual_base_game_review'] },
  'storm-full': { appid: 1336490, kind: 'developer', url: 'https://eremitegames.com/1-0-available/', roles: ['full_release_available'] },
  'kings-steam': { appid: 2784470, kind: 'steam_store', url: 'https://store.steampowered.com/app/2784470/9_Kings/', roles: ['steam_ea_date','steam_display_date','current_state','planned_full_release','manual_base_game_review'] },
  'darkwood-steam': { appid: 274520, kind: 'steam_store', url: 'https://store.steampowered.com/app/274520/Darkwood/?l=english', roles: ['steam_display_date','manual_base_game_review'] },
  'darkwood-presskit': { appid: 274520, kind: 'developer', url: 'https://www.darkwoodgame.com/presskit/', roles: ['general_ea_date','general_launch_date'] },
  'halflife-steam': { appid: 70, kind: 'steam_store', url: 'https://store.steampowered.com/app/70/', roles: ['steam_display_date','manual_base_game_review'] },
});
