/**
 * Unifies Guest and Group into whatever CategoryVoteCard actually needs to
 * render a nominee — it never needs bracket/photoRef/source/memberIds/etc.
 */
export interface Nominee {
  id: string;
  displayName: string;
  photoUrl: string | null;
}
