import type {
    GetSpaceResponse,
    GetSpaceStructuresResponse,
    SpaceStructure,
    GetObjectResponse,
    ListObjectsResponse,
    SearchObjectsResponse,
    SearchObjectResult,
    CreateObjectMarkdownBody,
    SaveToDailyNoteBody,
    GetObjectParams,
    DeleteObjectParams,
    ListObjectsByStructureParams,
    SearchObjectsBody,
    ApiBlock,
    ObjectProperties,
} from '@capacities/api';
import type { TransportRequest } from './transport/types.ts';

// Re-export SDK types and ergonomic aliases
export type {
    GetSpaceResponse,
    GetSpaceStructuresResponse,
    SpaceStructure,
    GetObjectResponse,
    ListObjectsResponse,
    SearchObjectsResponse,
    SearchObjectResult,
    CreateObjectMarkdownBody,
    SaveToDailyNoteBody,
    GetObjectParams,
    DeleteObjectParams,
    ListObjectsByStructureParams,
    SearchObjectsBody,
    ApiBlock,
    ObjectProperties,
};

// Ergonomic aliases matching domain terminology
export type CapacitiesSpace = GetSpaceResponse;
export type ListStructuresResponse = GetSpaceStructuresResponse;
export type CapacitiesStructure = SpaceStructure | { id: string; title?: string; [key: string]: unknown };
export type CapacitiesObject = GetObjectResponse;
export type StructureStub = SearchObjectResult;
export type ListObjectsByStructureResponse = ListObjectsResponse;

export interface Op<TInput, TOutput> {
    name: string;
    build: (input: TInput) => TransportRequest;
    parse: (rawText: string) => TOutput;
}

export interface HydratedObject {
    id: string;
    structureId?: string;
    title?: string;
    createdAt?: string;
    lastUpdated?: string;
    deepLink?: string;
    url?: string;
    raw: CapacitiesObject;
}

export interface DateRange {
    from: Date;
    to: Date;
}

export interface CaptureInput {
    text: string;
    structureId: string;
}

export interface CaptureResult {
    object: CapacitiesObject;
    embedded: boolean;
    warning?: string;
}

export interface SetupOptions {
    candidateTitles?: string[];
    forceStructureId?: string;
}

export interface SetupResult {
    space: CapacitiesSpace;
    structureId: string;
    structureTitle: string;
}

export interface ListInRangeInput {
    structureId: string;
    from: Date;
    to: Date;
}

export interface GetDailyNotesOptions {
    date?: Date;
    marginDays?: number;
}
