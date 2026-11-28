/**
 * Module 53: classification labels and rules shared by the screens and the
 * service. Pure: no server imports.
 *
 * Client, 24 Nov 2026: Small Commercial, Middle-Market, Complex / Custom, on
 * the account by default and overridable per request. The AM sets it; Senior
 * AM, Director of Agency Operations and COO override it; VAs and Pod Leaders
 * can only flag. Billing changes need a reason and are audited.
 */
import type { ClassFlagTarget, ServiceClass } from '@prisma/client';

export const SERVICE_CLASSES: readonly ServiceClass[] = ['SMALL_COMMERCIAL', 'MIDDLE_MARKET', 'COMPLEX_CUSTOM'];

export const SERVICE_CLASS_LABELS: Record<ServiceClass, string> = {
  SMALL_COMMERCIAL: 'Small Commercial',
  MIDDLE_MARKET: 'Middle-Market',
  COMPLEX_CUSTOM: 'Complex / Custom',
};

export const FLAG_TARGET_LABELS: Record<ClassFlagTarget, string> = {
  ACCOUNT: 'The account',
  REQUEST: 'This request only',
};

export const CLASS_REASON_MAX = 500;
export const FLAG_NOTE_MAX = 300;

export const isServiceClass = (v: unknown): v is ServiceClass => typeof v === 'string' && (SERVICE_CLASSES as readonly string[]).includes(v);

export interface ClassRights { set: boolean; override: boolean; flag: boolean }

/**
 * Who may change a classification: where none is set yet, anyone who may set
 * or override; once set, only those who may override.
 */
export const mayChange = (rights: ClassRights, current: ServiceClass | null): boolean =>
  current ? rights.override : rights.set || rights.override;

export const classLabel = (c: ServiceClass | null | undefined, none = 'Not classified'): string => (c ? SERVICE_CLASS_LABELS[c] : none);
