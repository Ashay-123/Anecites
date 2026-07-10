import { type PrismaClient } from "@anecites/db";

import { type AuthenticatedPrincipal, type AuthorizeRoom } from "./server.js";

const PRINCIPAL_ROLE_TO_PARTICIPANT_ROLE = {
  candidate: "CANDIDATE",
  interviewer: "INTERVIEWER",
} as const;

export function createSessionParticipantAuthorizer(prisma: PrismaClient): AuthorizeRoom {
  return async (principal, sessionId) => {
    const participantRole = toParticipantRole(principal.role);

    if (!participantRole) {
      return false;
    }

    const participant = await prisma.participant.findFirst({
      where: {
        sessionId,
        userId: principal.subject,
        role: participantRole,
        leftAt: null,
      },
      select: {
        id: true,
      },
    });

    return participant !== null;
  };
}

function toParticipantRole(
  principalRole: string,
): (typeof PRINCIPAL_ROLE_TO_PARTICIPANT_ROLE)[keyof typeof PRINCIPAL_ROLE_TO_PARTICIPANT_ROLE] | null {
  if (principalRole === "candidate" || principalRole === "interviewer") {
    return PRINCIPAL_ROLE_TO_PARTICIPANT_ROLE[principalRole];
  }

  return null;
}
