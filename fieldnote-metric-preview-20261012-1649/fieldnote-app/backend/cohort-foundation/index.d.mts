import type { ResearchWindow, ResearchGenre } from '../../src/research-types';
export interface FoundationInput {
 appId: number | string; genres: string[];
 releases: Record<string, Record<string, unknown>>;
 metrics: Record<string, number | null | { value: number | null; missingReason?: string }>;
}
export interface FoundationCohort {
 eligibleCount: number; excludedCount: number; exclusionCounts: Record<string, number>;
 releasePolicyVersion: string;
 eligibleGames: { appId: string; releaseDate: string }[];
 excludedGames: { appId: string; reason: string }[];
}
export function resolveReleaseWindow(input: { preset: string; asOf: string; startDate?: string; endDate?: string }): ResearchWindow;
export function resolveReviewWindows(input: { asOf: string }): { reviews7d: ResearchWindow; reviews30d: ResearchWindow };
export function analyzeGenres(games: FoundationInput[], options: { window: ResearchWindow; releaseBasis: string; metric: string; genreUniverse: string[] }): { statisticVersion: string; cohort: FoundationCohort; genres: ResearchGenre[]; unclassifiedAppIds: string[] };

export function parseUtcDay(value: unknown): number;
