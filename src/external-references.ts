export type Coordinates = {
  latitude: number;
  longitude: number;
};

const DECIMAL_COORDINATE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function hasExactHttpsAuthority(value: string, hostname: string): boolean {
  const authorityEnd = value.indexOf("/", "https://".length);
  if (authorityEnd < 0) return false;
  return value.slice("https://".length, authorityEnd).toLowerCase() === hostname;
}

export function parseCoordinates(value: string): Coordinates | undefined {
  const parts = value.split(",");
  if (parts.length !== 2) return undefined;
  const [latitudeText, longitudeText] = parts.map((part) => part.trim());
  if (!DECIMAL_COORDINATE.test(latitudeText) || !DECIMAL_COORDINATE.test(longitudeText)) return undefined;
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;
  return { latitude, longitude };
}

export function wikipediaSearchUrl(title: string): URL {
  const url = new URL("https://en.wikipedia.org/w/index.php");
  url.searchParams.set("search", title);
  return url;
}

export function parseWikipediaArticleUrl(value: string): URL | undefined {
  if (value.includes("?") || value.includes("#") || !hasExactHttpsAuthority(value, "en.wikipedia.org")) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.hostname !== "en.wikipedia.org" || url.username || url.password || url.port) return undefined;
  if (url.search || url.hash || !url.pathname.startsWith("/wiki/")) return undefined;
  const encodedArticle = url.pathname.slice("/wiki/".length);
  if (!encodedArticle) return undefined;
  try {
    if (!decodeURIComponent(encodedArticle).trim()) return undefined;
  } catch {
    return undefined;
  }
  return url;
}

export function isWikipediaArticleUrl(value: string): boolean {
  return parseWikipediaArticleUrl(value) !== undefined;
}

export function isTrustedWikimediaImageUrl(url: URL): boolean {
  return url.protocol === "https:"
    && url.hostname === "upload.wikimedia.org"
    && !url.username
    && !url.password
    && !url.port;
}

export function openStreetMapUrl(coordinates: Coordinates): URL {
  const latitude = String(coordinates.latitude);
  const longitude = String(coordinates.longitude);
  const url = new URL("https://www.openstreetmap.org/");
  url.searchParams.set("mlat", latitude);
  url.searchParams.set("mlon", longitude);
  url.hash = `map=13/${latitude}/${longitude}`;
  return url;
}

export function isTrustedExternalUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  if (url.hostname === "en.wikipedia.org") {
    return parseWikipediaArticleUrl(url.toString()) !== undefined
      || url.pathname === "/w/index.php"
      && url.searchParams.has("search")
      && Array.from(url.searchParams.keys()).every((key) => key === "search")
      && !url.hash;
  }
  if (url.hostname === "www.openstreetmap.org") {
    const keys = Array.from(url.searchParams.keys());
    return url.pathname === "/"
      && keys.length === 2
      && keys.includes("mlat")
      && keys.includes("mlon")
      && /^#map=13\/[+-]?(?:\d+(?:\.\d*)?|\.\d+)\/[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(url.hash);
  }
  return false;
}
