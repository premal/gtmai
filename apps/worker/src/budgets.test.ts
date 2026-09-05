import { describe, expect, it } from 'vitest';
import {
  budgetErrorMessage,
  budgetMatches,
  ledgerScopeFilter,
  spendExceedsBudget,
} from './budgets';

describe('budget scope filtering', () => {
  it('limits table budgets to the matching table ledger rows', () => {
    expect(budgetMatches('table:table-1', 'table-1')).toBe(true);
    expect(budgetMatches('table:table-1', 'table-2')).toBe(false);
    expect(ledgerScopeFilter('table:table-1', 'table-1')).toEqual({ tableId: 'table-1' });
  });

  it('limits provider budgets to the matching provider ledger rows', () => {
    expect(budgetMatches('provider:apollo', undefined, 'apollo')).toBe(true);
    expect(budgetMatches('provider:apollo', undefined, 'mock')).toBe(false);
    expect(ledgerScopeFilter('provider:apollo', undefined, 'apollo')).toEqual({
      provider: 'apollo',
    });
  });

  it('limits workbook budgets to the matching workbook ledger rows', () => {
    expect(budgetMatches('workbook:workbook-1', 'table-1', undefined, 'workbook-1')).toBe(true);
    expect(budgetMatches('workbook:workbook-1', 'table-1', undefined, 'workbook-2')).toBe(false);
    expect(ledgerScopeFilter('workbook:workbook-1', 'table-1', undefined, 'workbook-1')).toEqual({
      table: { workbookId: 'workbook-1' },
    });
  });

  it('marks work over the remaining budget as exceeded', () => {
    expect(spendExceedsBudget(-9, 2, 10)).toBe(true);
    expect(spendExceedsBudget(-9, 1, 10)).toBe(false);
  });

  it('formats credit-limit messages for each budget scope', () => {
    expect(budgetErrorMessage('workbook:workbook-1', { workbook: 'Revenue' })).toBe(
      'Credit limit reached for workbook Revenue',
    );
    expect(budgetErrorMessage('table:table-1', { table: 'Prospects' })).toBe(
      'Credit limit reached for table Prospects',
    );
    expect(budgetErrorMessage('provider:apollo')).toBe('Credit limit reached for provider apollo');
    expect(budgetErrorMessage('workspace')).toBe('Workspace credit limit reached');
  });
});
