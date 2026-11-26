function decodeFileUrlPath(url: URL): string {
  try {
    return decodeURIComponent(url.pathname || "");
  } catch {
    return url.pathname || "";
  }
}

function toWindowsSeparators(path: string): string {
  return path.replace(/\//g, "\\");
}

export function normalizeDroppedPath(rawPath: string): string {
  if (!rawPath) {
    return "";
  }

  if (!rawPath.startsWith("file://")) {
    return rawPath;
  }

  try {
    const url = new URL(rawPath);
    if (url.protocol !== "file:") {
      return rawPath;
    }

    const decodedPath = decodeFileUrlPath(url);
    if (url.host && url.host !== "localhost") {
      return `\\\\${url.host}${toWindowsSeparators(decodedPath)}`;
    }

    if (/^\/[A-Za-z]:\//.test(decodedPath)) {
      return toWindowsSeparators(decodedPath.slice(1));
    }

    return decodedPath;
  } catch {
    return rawPath;
  }
}

export function normalizeDroppedPaths(paths: readonly string[]): string[] {
  return paths
    .map(normalizeDroppedPath)
    .filter(Boolean);
}
