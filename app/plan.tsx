import { Redirect } from 'expo-router';

/**
 * The Plan tab is gone; the plan itself is now dynamic. The owner asks for a
 * portfolio read on the AI insights screen, Claude proposes the moves, and the
 * app pins them there as a checklist. This route survives only so that old
 * bookmarks and deep links land somewhere sensible instead of a 404.
 */
export default function PlanRedirect() {
  return <Redirect href="/insights" />;
}
