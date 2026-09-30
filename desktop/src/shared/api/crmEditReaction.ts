/** Project a signed CRM edit tag into the existing UI control representation. */
export function crmEditReactionContent(
  content: string,
  tags: string[][],
): string {
  const edits = tags.filter((tag) => tag[0] === "crm-edit");
  if (edits.length !== 1 || edits[0].length !== 2) return content;
  const payload = edits[0][1];
  if (payload.length > 65_536) return content;
  const match =
    /^crm-action-edit:v1:([A-Za-z0-9_-]{1,48}):([A-Za-z0-9_-]+)$/.exec(payload);
  if (!match || content !== `crm-edit:${match[1]}`) return content;
  return payload;
}
