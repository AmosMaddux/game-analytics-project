# Source contract checked 10 October 2026 UTC

Official references:
- Reviews: https://partner.steamgames.com/doc/webapi/IUserReviewsService
- Current players: https://partner.steamgames.com/doc/webapi/ISteamUserStats
- Host/routing overview: https://partner.steamgames.com/doc/webapi_overview

Reviews use the public `IUserReviewsService/GetAppReviews/v1/` endpoint with URL-encoded `input_json`, no key. Filters are Recent=1, all languages, all review types=0, Steam purchases=0, off-topic filtering enabled. Date starts and ends are both supplied and inclusive; `total_matching` is the period-query count. Cursor pagination uses at most 100 rows/page. Anonymous responses can be cached up to ten minutes and 429 denotes throttling. Summary score totals belong to their documented query scope and are kept separate from period evidence. Although Valve now deprecates store `/appreviews`, this project's old saved API observations already use the current service.

Current-player requests use the public host and AppID only. The count excludes players disconnected from Steam. The documentation's partner-host examples must not be mistaken for anonymous public URLs: the overview says the partner-only host requires publisher credentials. This bundle never uses that host or IP addresses.

These documentation checks establish endpoint mechanics, not a commercial license or tag-collection permission. No provider terms are accepted by the code.
