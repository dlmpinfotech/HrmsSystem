/** HR helpdesk constants shared by the UI and tests (the database enforces the same values). */
export const TICKET_CATEGORIES = ['payroll', 'leave', 'attendance', 'policy', 'it', 'grievance', 'other'] as const;
export const ARTICLE_CATEGORIES = ['payroll', 'leave', 'attendance', 'policy', 'it', 'other'] as const;
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const TICKET_STATUSES = ['open', 'waiting_employee', 'resolved', 'closed'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Overdue = HR has not answered yet and the answer-by time has passed. */
export function isOverdue(t: { status: string; due_at: string | null; first_response_at: string | null }, now = Date.now()): boolean {
  return t.status === 'open' && !t.first_response_at && Boolean(t.due_at) && Date.parse(t.due_at!) < now;
}
