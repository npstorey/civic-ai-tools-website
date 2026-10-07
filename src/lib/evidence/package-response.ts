// The package route's success answer (#553): the stored object's text, as it
// was stored, with a JSON content type.
//
// The route used to parse the stored text and answer with `NextResponse.json`,
// which re-serializes it. For a package written by `putPackage` that happens to
// give the same bytes back, because the stored text is itself `JSON.stringify`
// output; for any other stored text (indentation, `1.0`, a `\u` escape) it does
// not. A download of a signed record is the stored bytes, so nothing here
// parses, re-encodes or normalizes them.
//
// `src/app/api/evidence/package-route.test.ts` drives this through the real
// route and compares SHA-256 digests.

export function storedPackageResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
