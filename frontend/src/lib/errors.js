import {BaseError, ContractFunctionRevertedError, UserRejectedRequestError} from 'viem';

const FRIENDLY = {
  NotVerified: 'This wallet is not an eligible, verified investor in the identity registry.',
  AccountFrozen: 'This wallet has been frozen by the transfer agent.',
  BelowMinimum: 'Below the minimum subscription of 250,000 tUSDC.',
  ExceedsTarget: 'That is more than the notes still available.',
  WrongPhase: 'That action is not available in the programme\'s current phase.',
  OracleNotReady: 'Not enough fresh oracle readings yet. Both data feeds must report (quorum).',
  ObservationOutsideRiskPeriod: 'The latest readings were taken before the risk period started. Submit a new reading.',
  RiskPeriodEnded: 'The risk period has ended. Events after maturity are not covered.',
  NoNewTrigger: 'No new tier is met. Both rainfall and river level must pass a higher threshold.',
  NoPendingTrigger: 'There is no proposed trigger for this location.',
  DisputeWindowOpen: 'The dispute window is still open. The payout can be executed when it closes.',
  DisputeWindowClosed: 'The dispute window has closed; the trigger can no longer be challenged.',
  NotCedentOrManager: 'Only this location\'s insurer or Parapet can change its allocation plan.',
  AlreadySettled: 'This payout has already been settled.',
  NotClaimable: 'The fund has not settled this redemption yet.',
  TriggerPending: 'A trigger is pending for this location. Resolve it first.',
  RiskPeriodNotOver: 'The risk period has not ended yet.',
  NothingToClaim: 'Nothing to claim yet.',
  ZeroAmount: 'Enter an amount above zero.',
  AboveInstantLimit: 'Above the fund\'s instant liquidity limit.',
  StaleObservation: 'That reading is too old (older than the oracle\'s 6-hour limit).',
  FutureObservation: 'That reading is time-stamped in the future.',
  UnknownStation: 'Unknown station.',
  AccessControlUnauthorizedAccount: 'This wallet does not hold the role needed for that action.',
  EnforcedPause: 'The programme is paused.',
  ERC20InsufficientBalance: 'Not enough balance.',
  ERC20InsufficientAllowance: 'Token approval is too low.',
  FaucetLimit: 'The faucet gives at most 10,000,000 tUSDC per request.',
  InvalidConfig: 'Those parameters are not valid (check that sub-limits and district shares add up to 100%).',
};

export function describeError(error) {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) return 'You rejected the request in your wallet.';
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    const name = revert?.data?.errorName;
    if (name) return FRIENDLY[name] ?? `Reverted: ${name}`;
    return error.shortMessage || error.message;
  }
  return error?.message || String(error);
}
