import { branchRepository, type NewBranch } from '../repositories/branch.repository';
import type { Branch } from '../types/branch';

export interface BranchDraft {
  name: string;
  code: string;
}

export type BranchFormErrors = Partial<Record<keyof BranchDraft, string>>;

/** Client-side validation for instant feedback — `idx_branches_code_active`'s unique index is the authoritative copy (master-data-management.md §4). */
export function validateBranch(form: BranchDraft): BranchFormErrors {
  const errors: BranchFormErrors = {};
  if (!form.name.trim()) errors.name = 'Name is required';
  if (!form.code.trim()) errors.code = 'Code is required';
  return errors;
}

export function isBranchFormValid(errors: BranchFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

function draftToNewBranch(form: BranchDraft): NewBranch {
  return { name: form.name.trim(), code: form.code.trim() };
}

export const branchService = {
  validateBranch,
  isBranchFormValid,

  async create(form: BranchDraft): Promise<Branch> {
    return branchRepository.create(draftToNewBranch(form));
  },

  async update(id: number, form: BranchDraft): Promise<void> {
    return branchRepository.update(id, draftToNewBranch(form));
  },
};

export type BranchService = typeof branchService;
