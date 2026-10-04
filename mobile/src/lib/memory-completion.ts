export type ContributionPhase = 'preparing' | 'uploading' | 'success' | 'error';

export function hasActiveContributions(uploads: { phase: ContributionPhase }[]): boolean {
  return uploads.some((draft) => draft.phase === 'preparing' || draft.phase === 'uploading');
}

export function canCompleteMemory(input: {
  hasSavedContent: boolean;
  text: string;
  title: string;
  draftReady: boolean;
  uploads: { phase: ContributionPhase }[];
  mutationPending: boolean;
  recording: boolean;
  voiceBusy: boolean;
  mediaBusy: boolean;
}): boolean {
  // A failed optional item is not a contribution and must not invalidate other
  // real content. Active work still has to finish before completion.
  return (input.hasSavedContent || Boolean(input.text.trim())) &&
    Boolean(input.title.trim()) && input.draftReady &&
    !hasActiveContributions(input.uploads) && !input.mutationPending &&
    !input.recording && !input.voiceBusy && !input.mediaBusy;
}
