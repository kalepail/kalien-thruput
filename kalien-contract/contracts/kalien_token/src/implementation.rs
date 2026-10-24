//! KALIEN: a standard ERC20 token whose only minter is its administrator.
//!
//! The deployer initializes the token with itself as administrator, deploys
//! the score contract, and then hands administration to the score contract
//! with `set_administrator`. After that only score submissions can mint.

use thruput_sdk::storage::deletable::Deletable;
use thruput_sdk::storage::{Balance, Map, Value};
use thruput_sdk::*;
use thruput_erc20_if::*;
use thruput_erc20_metadata_if::{ERC20Metadata, Name, Symbol};

/// KALIEN uses 7 decimals, like the native token: 1 KALIEN = 10^7 units.
pub const DECIMALS: u32 = 7;
pub const NAME: &str = "Kalien";
pub const SYMBOL: &str = "KALIEN";

type Allowance = Balance;

#[thruput_sdk::storage]
#[cfg_attr(feature = "dev", derive(Debug))]
pub struct KalienToken {
    config: Value<Config>,
    balances: Map<ContractAddress, Balance>,
    allowances: Map<ContractAddress, Map<ContractAddress, Allowance>>,
    total_supply: Balance,
}

#[contract_type]
#[cfg_attr(feature = "dev", derive(Debug))]
pub struct Config {
    pub administrator: ContractAddress,
    pub name: Option<Name>,
    pub symbol: Option<Symbol>,
    pub decimals: Option<u32>,
}

/// Errors of the KALIEN administration extension.
#[contract_exception]
pub enum KalienTokenError {
    NotAdministrator = 1,
}

/// Emitted when the administrator (the only minter) changes.
#[derive(Event, Clone, Debug)]
pub struct AdministratorChanged {
    #[topic]
    pub previous: ContractAddress,
    #[topic]
    pub administrator: ContractAddress,
}

/// Administration of the token: who may mint.
#[contract(
    client = KalienTokenAdminClient,
    throws = KalienTokenError,
    emits(AdministratorChanged)
)]
pub trait KalienTokenAdmin {
    /// Hand administration (and so mint authority) to `administrator`.
    /// Only the current administrator may call this.
    fn set_administrator(&mut self, administrator: &ContractAddress);

    /// The current administrator.
    fn administrator(&self) -> ContractAddress;
}

impl KalienToken {
    fn _init(&mut self, config: &Config) {
        if self.config.try_get().none_if_missing().is_some() {
            throw(ERC20Error::AlreadyInitialized);
        }
        self.config.set(config)
    }

    fn _administrator(&self) -> ContractAddress {
        self.config.get().administrator
    }

    fn _require_administrator(&self) {
        ensure(
            get_caller() == self._administrator(),
            ERC20Error::MustBeContractOwner,
        );
    }

    fn _balance_amount_of(&self, owner: &ContractAddress) -> Amount {
        self.balances.at(owner).get()
    }

    fn _lazy_increase_balance(&mut self, owner: &ContractAddress, amount: Amount) {
        self.balances
            .at_mut(owner)
            .try_lazy_increase(amount)
            .unwrap_or_else(|_| throw(ERC20Error::TooLarge));
    }

    fn _decrease_balance(&mut self, owner: &ContractAddress, amount: Amount) {
        self.balances
            .at_mut(owner)
            .try_decrease(amount)
            .unwrap_or_else(|_| throw(ERC20Error::TooLarge));
    }

    fn _allowance(&self, owner: &ContractAddress, spender: &ContractAddress) -> Amount {
        self.allowances.at(owner).at(spender).get()
    }

    fn _adjust_allowance(
        &mut self,
        owner: &ContractAddress,
        spender: &ContractAddress,
        difference: Difference,
    ) {
        let mut owner_allowances = self.allowances.at_mut(owner);
        let mut allowance = owner_allowances.at_mut(spender);
        let result = if difference >= 0 {
            allowance.try_increase(difference)
        } else {
            let decrement = difference
                .checked_neg()
                .unwrap_or_else(|| throw(ERC20Error::TooLarge));
            allowance.try_decrease(decrement)
        };
        result.unwrap_or_else(|_| throw(ERC20Error::TooLarge));

        AllowanceChangeEvent::new(owner, spender, difference).log();
    }

    fn _spend_allowance(
        &mut self,
        owner: &ContractAddress,
        spender: &ContractAddress,
        amount: Amount,
    ) {
        self.allowances
            .at_mut(owner)
            .at_mut(spender)
            .try_decrease(amount)
            .unwrap_or_else(|_| throw(ERC20Error::TooLarge));
    }

    fn _move(&mut self, owner: &ContractAddress, receiver: &ContractAddress, amount: Amount) {
        self._decrease_balance(owner, amount);
        self._lazy_increase_balance(receiver, amount);

        TransferEvent::new(owner, receiver, amount).log();
    }
}

#[contract]
impl ERC20 for KalienToken {
    fn initialize(&mut self, administrator: &ContractAddress) {
        self._init(&Config {
            administrator: *administrator,
            name: Some(Name::try_from(NAME).unwrap_or_else(|_| throw(ERC20Error::Internal))),
            symbol: Some(Symbol::try_from(SYMBOL).unwrap_or_else(|_| throw(ERC20Error::Internal))),
            decimals: Some(DECIMALS),
        });
    }

    fn transfer(&mut self, receiver: &ContractAddress, amount: Amount) {
        check_amount(amount);
        let owner = get_caller();
        self._move(&owner, receiver, amount);
    }

    fn transfer_from(
        &mut self,
        owner: &ContractAddress,
        receiver: &ContractAddress,
        amount: Amount,
    ) {
        check_amount(amount);
        let spender = get_caller();
        self._spend_allowance(owner, &spender, amount);
        self._move(owner, receiver, amount);
    }

    fn adjust_allowance(&mut self, spender: &ContractAddress, difference: Difference) {
        let owner = get_caller();
        self._adjust_allowance(&owner, spender, difference);
    }

    fn delete_allowance(&mut self, spender: &ContractAddress) {
        let owner = get_caller();
        let removed = self._allowance(&owner, spender);
        self.allowances
            .at_mut(&owner)
            .at_mut(spender)
            .delete_exclusive();
        AllowanceDeleteEvent::new(&owner, spender, removed).log();
    }

    fn delete_balance(&mut self) {
        let owner = get_caller();
        let mut balance = self.balances.at_mut(&owner);
        ensure(balance.get() == 0, ERC20Error::BalanceNotZero);
        balance.delete_exclusive();
    }

    fn allowance(&self, owner: &ContractAddress, spender: &ContractAddress) -> Amount {
        self._allowance(owner, spender)
    }

    fn get_balance_of(&self, owner: &ContractAddress) -> Amount {
        self._balance_amount_of(owner)
    }

    fn get_balance(&self) -> Amount {
        let owner = get_caller();
        self._balance_amount_of(&owner)
    }

    fn mint(&mut self, receiver: &ContractAddress, amount: Amount) {
        check_amount(amount);
        self._require_administrator();

        // The checked supply bound first: once it holds, the lazy receiver
        // increase cannot overflow an individual balance.
        self.total_supply
            .try_increase(amount)
            .unwrap_or_else(|_| throw(ERC20Error::TooLarge));
        self._lazy_increase_balance(receiver, amount);

        MintEvent::new(receiver, amount).log();
    }

    fn total_supply(&self) -> Amount {
        self.total_supply.get()
    }
}

#[contract]
impl ERC20Metadata for KalienToken {
    fn initialize(
        &mut self,
        administrator: &ContractAddress,
        name: Option<Name>,
        symbol: Option<Symbol>,
        decimals: Option<u32>,
    ) {
        self._init(&Config {
            administrator: *administrator,
            name,
            symbol,
            decimals,
        });
    }

    fn name(&self) -> Option<Name> {
        self.config.get().name
    }

    fn symbol(&self) -> Option<Symbol> {
        self.config.get().symbol
    }

    fn decimals(&self) -> Option<u32> {
        self.config.get().decimals
    }
}

#[contract]
impl KalienTokenAdmin for KalienToken {
    fn set_administrator(&mut self, administrator: &ContractAddress) {
        let mut config = self.config.get();
        let previous = config.administrator;
        ensure(get_caller() == previous, KalienTokenError::NotAdministrator);
        config.administrator = *administrator;
        self.config.set(&config);
        log_event(&AdministratorChanged {
            previous,
            administrator: *administrator,
        });
    }

    fn administrator(&self) -> ContractAddress {
        self._administrator()
    }
}
