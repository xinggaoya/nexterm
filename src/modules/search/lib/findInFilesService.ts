import { native } from "@/lib/native";
import type { FsGrepHit, FsGrepResult } from "@/lib/native";

export type FindInFilesRequest = {
  root: string;
  pattern: string;
  caseInsensitive: boolean;
  includeGlobs: string[];
};

export type FindInFilesResponse = {
  hits: FsGrepHit[];
  truncated: boolean;
  filesScanned: number;
};

export async function runFindInFiles(
  req: FindInFilesRequest,
): Promise<FindInFilesResponse> {
  if (!req.pattern.trim()) {
    return { hits: [], truncated: false, filesScanned: 0 };
  }
  const result: FsGrepResult = await native.fsGrep(req.pattern, req.root, {
    glob: req.includeGlobs.length > 0 ? req.includeGlobs : undefined,
    caseInsensitive: req.caseInsensitive,
  });
  return {
    hits: result.hits,
    truncated: result.truncated,
    filesScanned: result.filesScanned,
  };
}
