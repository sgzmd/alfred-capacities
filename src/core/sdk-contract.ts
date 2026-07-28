import type {
  CreateObjectFromUrlBody,
  GetObjectResponse,
  SaveToDailyNoteBody,
  SearchObjectsBody,
  SearchObjectsResponse
} from "@capacities/api";

export type SearchBody = SearchObjectsBody;
export type SearchResponse = SearchObjectsResponse;
export type ObjectResponse = GetObjectResponse;
export type CreateWeblinkBody = CreateObjectFromUrlBody;
export type DailyNoteBody = SaveToDailyNoteBody;

export const API_VERSION = "0.1.0";
export const WEBLINK_STRUCTURE_ID = "MediaWebResource";
