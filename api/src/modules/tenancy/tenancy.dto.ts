import type { ActorContext, WorkspaceList, WorkspaceSummary } from '@drezivo/contracts';

import type { ResolvedActorContext, WorkspacePage } from './tenancy.repository.js';

export function toWorkspaceList(page: WorkspacePage): WorkspaceList {
  return {
    items: page.items.map(toWorkspaceSummary),
    page_meta: {
      next_cursor: page.nextCursor,
      has_more: page.hasMore,
    },
  };
}

function toWorkspaceSummary(workspace: WorkspaceSummary): WorkspaceSummary {
  return workspace;
}

export function toActorContext(context: ResolvedActorContext): ActorContext {
  return {
    tenant: context.tenant,
    membership: context.membership,
    branches: context.branches,
    active_branch_id: context.active_branch_id,
    branch_grants: context.branch_grants,
    subscription: context.subscription,
    access: context.access,
    entitlements: context.entitlements,
  };
}
