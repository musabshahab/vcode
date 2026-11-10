interface CanvasObstacle {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

export const DETAILS_CARD_CLEARANCE = 32;

export function resolveChatCanvasLayout({
  container,
  padding = 48,
  maxChatWidth = 768,
  detailsCard = null,
}: {
  container: { readonly width: number; readonly height: number };
  padding?: number;
  maxChatWidth?: number;
  detailsCard?: CanvasObstacle | null;
}) {
  const centeredWidth = Math.max(0, Math.min(maxChatWidth, container.width - padding * 2));
  const laneRight = detailsCard
    ? detailsCard.left - DETAILS_CARD_CLEARANCE
    : container.width - padding;
  const normalWidth = Math.max(0, Math.min(centeredWidth, laneRight - padding));
  const canvasCenterLeft = (container.width - normalWidth) / 2;
  const normalLeft = Math.max(padding, Math.min(canvasCenterLeft, laneRight - normalWidth));
  const chat = {
    left: normalLeft,
    width: normalWidth,
    insetStart: 0,
    insetEnd: Math.max(0, container.width - normalLeft * 2 - normalWidth),
  };
  return { chat };
}
