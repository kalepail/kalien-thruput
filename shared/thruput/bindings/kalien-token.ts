// Generated from kalien_token.spec.xdr - ERC20 interface v0.1.56
// Generated from kalien_token.spec.xdr - ERC20Metadata interface v0.1.56
// Generated from kalien_token.spec.xdr - KalienTokenAdmin interface v0.1.0
// DO NOT EDIT. Re-run codegen to update.

import * as __gh_protocol from "@thruputchain/protocol";
import * as __gh_protocol_utils from "@thruputchain/protocol/utils";
import * as __gh_contract_spec from "@thruputchain/contract-spec";
import * as __gh_client_contract from "@thruputchain/client/contract";

const __gh_s = __gh_contract_spec.contractSpecString;

const __gh_entrypoints = {
  ERC20: {
    v0_1: {
      adjustAllowance: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("d5acf88949a80342")),
      allowance: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("d296058ebcf260cb")),
      deleteAllowance: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("dafe89d86eaf8ddf")),
      deleteBalance: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("2924d916f07d51aa")),
      getBalance: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("b921b642d31d7dac")),
      getBalanceOf: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("41ac95d6e06e2620")),
      initialize: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("18944c3aa4944671")),
      mint: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("f3f3bd9dede066a3")),
      totalSupply: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("2cbfcd0cb5c3f962")),
      transfer: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("63285b3523f9dc3f")),
      transferFrom: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("695be60513fcc294")),
    },
  },
  ERC20Metadata: {
    v0_1: {
      decimals: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("d9462e42964991d0")),
      initialize: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("f65b96296d684b0b")),
      name: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("51ad51ee8a5d9dd8")),
      symbol: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("3ddac721aa5abdea")),
    },
  },
  KalienTokenAdmin: {
    v0_1: {
      administrator: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("dae4df4937e35781")),
      setAdministrator: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("adfbdf904f43c0e6")),
    },
  },
} as const;

export namespace kalien_token {

  export namespace v0_1 {

    export namespace implementation {

      export type KalienTokenError = 1n;

      export interface AdministratorChanged extends __gh_client_contract.DecodedContractEvent<
        "AdministratorChanged",
        { "previous": __gh_protocol.ContractAddress; "administrator": __gh_protocol.ContractAddress },
        {  }
      > {}

      export interface AdministratorChangedFilter {
        "previous"?: __gh_client_contract.ContractEventFilterValue<__gh_protocol.ContractAddress>;
        "administrator"?: __gh_client_contract.ContractEventFilterValue<__gh_protocol.ContractAddress>;
      }
    }
  }
}

export namespace thruput_erc20_if {

  export namespace v0_1 {

    export namespace error {

      export type ERC20Error = 1n | 2n | 3n | 4n | 5n | 100n;
    }

    export namespace events {

      export interface AllowanceChangeEvent extends __gh_client_contract.DecodedContractEvent<
        "AllowanceChangeEvent",
        { "owner": __gh_protocol.ContractAddress; "spender": __gh_protocol.ContractAddress },
        { "difference": bigint }
      > {}

      export interface AllowanceChangeEventFilter {
        "owner"?: __gh_client_contract.ContractEventFilterValue<__gh_protocol.ContractAddress>;
        "spender"?: __gh_client_contract.ContractEventFilterValue<__gh_protocol.ContractAddress>;
      }

      export interface AllowanceDeleteEvent extends __gh_client_contract.DecodedContractEvent<
        "AllowanceDeleteEvent",
        { "owner": __gh_protocol.ContractAddress; "spender": __gh_protocol.ContractAddress },
        { "removed": bigint }
      > {}

      export interface AllowanceDeleteEventFilter {
        "owner"?: __gh_client_contract.ContractEventFilterValue<__gh_protocol.ContractAddress>;
        "spender"?: __gh_client_contract.ContractEventFilterValue<__gh_protocol.ContractAddress>;
      }

      export interface MintEvent extends __gh_client_contract.DecodedContractEvent<
        "MintEvent",
        { "to": __gh_protocol.ContractAddress },
        { "amount": bigint }
      > {}

      export interface MintEventFilter {
        "to"?: __gh_client_contract.ContractEventFilterValue<__gh_protocol.ContractAddress>;
      }

      export interface TransferEvent extends __gh_client_contract.DecodedContractEvent<
        "TransferEvent",
        { "from": __gh_protocol.ContractAddress; "to": __gh_protocol.ContractAddress },
        { "amount": bigint }
      > {}

      export interface TransferEventFilter {
        "from"?: __gh_client_contract.ContractEventFilterValue<__gh_protocol.ContractAddress>;
        "to"?: __gh_client_contract.ContractEventFilterValue<__gh_protocol.ContractAddress>;
      }
    }
  }
}

export namespace ERC20 {

  export namespace v0_1 {

    export interface AdjustAllowanceArgs {
      spender: __gh_protocol.ContractAddress;
      difference: bigint;
    }
    export type AdjustAllowanceResult = void;

    export interface AllowanceArgs {
      owner: __gh_protocol.ContractAddress;
      spender: __gh_protocol.ContractAddress;
    }
    export type AllowanceResult = bigint;

    export interface DeleteAllowanceArgs {
      spender: __gh_protocol.ContractAddress;
    }
    export type DeleteAllowanceResult = void;

    export type DeleteBalanceArgs = void;
    export type DeleteBalanceResult = void;

    export type GetBalanceArgs = void;
    export type GetBalanceResult = bigint;

    export interface GetBalanceOfArgs {
      addr: __gh_protocol.ContractAddress;
    }
    export type GetBalanceOfResult = bigint;

    export interface InitializeArgs {
      administrator: __gh_protocol.ContractAddress;
    }
    export type InitializeResult = void;

    export interface MintArgs {
      receiver: __gh_protocol.ContractAddress;
      amount: bigint;
    }
    export type MintResult = void;

    export type TotalSupplyArgs = void;
    export type TotalSupplyResult = bigint;

    export interface TransferArgs {
      receiver: __gh_protocol.ContractAddress;
      amount: bigint;
    }
    export type TransferResult = void;

    export interface TransferFromArgs {
      owner: __gh_protocol.ContractAddress;
      receiver: __gh_protocol.ContractAddress;
      amount: bigint;
    }
    export type TransferFromResult = void;

    export type DeclaredException =
      {
        kind: "declared";
        name: "ERC20Error";
        selector: 0xb19947acb2fa14ffn;
        value: __gh_codegen.thruput_erc20_if$v0_1$error$ERC20Error;
      };
    export type Exception = __gh_client_contract.ContractException<DeclaredException>;
  }
}

export namespace ERC20Metadata {

  export namespace v0_1 {

    export type DecimalsArgs = void;
    export type DecimalsResult = bigint | null;

    export interface InitializeArgs {
      administrator: __gh_protocol.ContractAddress;
      name: string | null;
      symbol: string | null;
      decimals: bigint | null;
    }
    export type InitializeResult = void;

    export type NameArgs = void;
    export type NameResult = string | null;

    export type SymbolArgs = void;
    export type SymbolResult = string | null;

    export type DeclaredException = never;
    export type Exception = __gh_client_contract.ContractException<DeclaredException>;
  }
}

export namespace KalienTokenAdmin {

  export namespace v0_1 {

    export type AdministratorArgs = void;
    export type AdministratorResult = __gh_protocol.ContractAddress;

    export interface SetAdministratorArgs {
      administrator: __gh_protocol.ContractAddress;
    }
    export type SetAdministratorResult = void;

    export type DeclaredException =
      {
        kind: "declared";
        name: "KalienTokenError";
        selector: 0x10f34552a2821e8an;
        value: __gh_codegen.kalien_token$v0_1$implementation$KalienTokenError;
      };
    export type Exception = __gh_client_contract.ContractException<DeclaredException>;
  }
}

export const spec: __gh_client_contract.ContractSpec = {
  interfaces: [
    {
      name: __gh_s("ERC20"),
      vers: __gh_s("0.1.56"),
      throws: [
        { selector: 0xb19947acb2fa14ffn, ty: { v: __gh_contract_spec.ContractTypeKind.Named, named: { crate_name: __gh_s("thruput-erc20-if"), major: __gh_s("0.1"), module_path: __gh_s("thruput_erc20_if::error"), declared: __gh_s("ERC20Error") } } },
      ],
      methods: [
        {
          name: __gh_s("adjust_allowance"),
          args: [
            { name: __gh_s("spender"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
            { name: __gh_s("difference"), ty: { v: __gh_contract_spec.ContractTypeKind.I128 } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("allowance"),
          args: [
            { name: __gh_s("owner"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
            { name: __gh_s("spender"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.I128 },
          effect: null,
        },
        {
          name: __gh_s("delete_allowance"),
          args: [
            { name: __gh_s("spender"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("delete_balance"),
          args: [
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("get_balance"),
          args: [
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.I128 },
          effect: null,
        },
        {
          name: __gh_s("get_balance_of"),
          args: [
            { name: __gh_s("addr"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.I128 },
          effect: null,
        },
        {
          name: __gh_s("initialize"),
          args: [
            { name: __gh_s("administrator"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("mint"),
          args: [
            { name: __gh_s("receiver"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
            { name: __gh_s("amount"), ty: { v: __gh_contract_spec.ContractTypeKind.I128 } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("total_supply"),
          args: [
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.I128 },
          effect: null,
        },
        {
          name: __gh_s("transfer"),
          args: [
            { name: __gh_s("receiver"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
            { name: __gh_s("amount"), ty: { v: __gh_contract_spec.ContractTypeKind.I128 } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("transfer_from"),
          args: [
            { name: __gh_s("owner"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
            { name: __gh_s("receiver"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
            { name: __gh_s("amount"), ty: { v: __gh_contract_spec.ContractTypeKind.I128 } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
      ],
    },
    {
      name: __gh_s("ERC20Metadata"),
      vers: __gh_s("0.1.56"),
      throws: [
      ],
      methods: [
        {
          name: __gh_s("decimals"),
          args: [
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Option, option_inner: { v: __gh_contract_spec.ContractTypeKind.U32 } },
          effect: null,
        },
        {
          name: __gh_s("initialize"),
          args: [
            { name: __gh_s("administrator"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
            { name: __gh_s("name"), ty: { v: __gh_contract_spec.ContractTypeKind.Option, option_inner: { v: __gh_contract_spec.ContractTypeKind.String } } },
            { name: __gh_s("symbol"), ty: { v: __gh_contract_spec.ContractTypeKind.Option, option_inner: { v: __gh_contract_spec.ContractTypeKind.String } } },
            { name: __gh_s("decimals"), ty: { v: __gh_contract_spec.ContractTypeKind.Option, option_inner: { v: __gh_contract_spec.ContractTypeKind.U32 } } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("name"),
          args: [
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Option, option_inner: { v: __gh_contract_spec.ContractTypeKind.String } },
          effect: null,
        },
        {
          name: __gh_s("symbol"),
          args: [
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Option, option_inner: { v: __gh_contract_spec.ContractTypeKind.String } },
          effect: null,
        },
      ],
    },
    {
      name: __gh_s("KalienTokenAdmin"),
      vers: __gh_s("0.1.0"),
      throws: [
        { selector: 0x10f34552a2821e8an, ty: { v: __gh_contract_spec.ContractTypeKind.Named, named: { crate_name: __gh_s("kalien_token"), major: __gh_s("0.1"), module_path: __gh_s("kalien_token::implementation"), declared: __gh_s("KalienTokenError") } } },
      ],
      methods: [
        {
          name: __gh_s("administrator"),
          args: [
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Address },
          effect: null,
        },
        {
          name: __gh_s("set_administrator"),
          args: [
            { name: __gh_s("administrator"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
      ],
    },
  ],
  type_defs: [
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefEnum,
      enum_def: {
        name: { crate_name: __gh_s("kalien_token"), major: __gh_s("0.1"), module_path: __gh_s("kalien_token::implementation"), declared: __gh_s("KalienTokenError") },
        variants: [
          { name: __gh_s("NotAdministrator"), value: 1n },
        ],
      },
    },
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefEnum,
      enum_def: {
        name: { crate_name: __gh_s("thruput-erc20-if"), major: __gh_s("0.1"), module_path: __gh_s("thruput_erc20_if::error"), declared: __gh_s("ERC20Error") },
        variants: [
          { name: __gh_s("AlreadyInitialized"), value: 1n },
          { name: __gh_s("MustBeContractOwner"), value: 2n },
          { name: __gh_s("TooLarge"), value: 3n },
          { name: __gh_s("BalanceNotZero"), value: 4n },
          { name: __gh_s("NegativeAmount"), value: 5n },
          { name: __gh_s("Internal"), value: 100n },
        ],
      },
    },
  ],
  events: [
    {
      name: { crate_name: __gh_s("kalien_token"), major: __gh_s("0.1"), module_path: __gh_s("kalien_token::implementation"), declared: __gh_s("AdministratorChanged") },
      signature: __gh_protocol.topic(__gh_protocol_utils.fromHex("005726209506ec53170ea2698e84e072197a9480a36252b1ff7ba2e6abd4e8db")),
      topics: [
        { name: __gh_s("previous"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
        { name: __gh_s("administrator"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
      ],
      fields: [
      ],
    },
    {
      name: { crate_name: __gh_s("thruput-erc20-if"), major: __gh_s("0.1"), module_path: __gh_s("thruput_erc20_if::events"), declared: __gh_s("AllowanceChangeEvent") },
      signature: __gh_protocol.topic(__gh_protocol_utils.fromHex("8f651cf72869c41d81740e5d5c083f66b7cb8c9041ab203c243c8296ac0fb050")),
      topics: [
        { name: __gh_s("owner"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
        { name: __gh_s("spender"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
      ],
      fields: [
        { name: __gh_s("difference"), ty: { v: __gh_contract_spec.ContractTypeKind.I128 } },
      ],
    },
    {
      name: { crate_name: __gh_s("thruput-erc20-if"), major: __gh_s("0.1"), module_path: __gh_s("thruput_erc20_if::events"), declared: __gh_s("AllowanceDeleteEvent") },
      signature: __gh_protocol.topic(__gh_protocol_utils.fromHex("a772908a2b54d41264c01ed43b3e7c45cc58a0adce069df7c9c427158c2efb75")),
      topics: [
        { name: __gh_s("owner"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
        { name: __gh_s("spender"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
      ],
      fields: [
        { name: __gh_s("removed"), ty: { v: __gh_contract_spec.ContractTypeKind.I128 } },
      ],
    },
    {
      name: { crate_name: __gh_s("thruput-erc20-if"), major: __gh_s("0.1"), module_path: __gh_s("thruput_erc20_if::events"), declared: __gh_s("MintEvent") },
      signature: __gh_protocol.topic(__gh_protocol_utils.fromHex("10c4493b678f7f00f19a3bbf4fa153186a2d1f4cf328a495718af7679fa54ea4")),
      topics: [
        { name: __gh_s("to"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
      ],
      fields: [
        { name: __gh_s("amount"), ty: { v: __gh_contract_spec.ContractTypeKind.I128 } },
      ],
    },
    {
      name: { crate_name: __gh_s("thruput-erc20-if"), major: __gh_s("0.1"), module_path: __gh_s("thruput_erc20_if::events"), declared: __gh_s("TransferEvent") },
      signature: __gh_protocol.topic(__gh_protocol_utils.fromHex("5ff62377bf52711e75461f4d8f9b4585f17d1c20f7e1eceb280194a7764bae5f")),
      topics: [
        { name: __gh_s("from"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
        { name: __gh_s("to"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
      ],
      fields: [
        { name: __gh_s("amount"), ty: { v: __gh_contract_spec.ContractTypeKind.I128 } },
      ],
    },
  ],
};

const __gh_codecs = __gh_client_contract.createContractCodecContext(spec.type_defs);

export const ERC20 = {
  v0_1: {
    adjustAllowance: __gh_client_contract.defineContractMethod<
      ERC20.v0_1.AdjustAllowanceArgs,
      ERC20.v0_1.AdjustAllowanceResult,
      ERC20.v0_1.DeclaredException
    >({
      interfaceName: "ERC20",
      interfaceVersion: "0.1.56",
      abiName: "adjust_allowance",
      publicName: "adjustAllowance",
      entrypoint: __gh_entrypoints.ERC20.v0_1.adjustAllowance,
      effect: spec.interfaces[0]!.methods[0]!.effect,
      args: [
        {
          abiName: "spender",
          publicName: "spender",
          type: spec.interfaces[0]!.methods[0]!.args[0]!.ty,
        },
        {
          abiName: "difference",
          publicName: "difference",
          type: spec.interfaces[0]!.methods[0]!.args[1]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[0]!.return_type,
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          name: "ERC20Error",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    allowance: __gh_client_contract.defineContractMethod<
      ERC20.v0_1.AllowanceArgs,
      ERC20.v0_1.AllowanceResult,
      ERC20.v0_1.DeclaredException
    >({
      interfaceName: "ERC20",
      interfaceVersion: "0.1.56",
      abiName: "allowance",
      publicName: "allowance",
      entrypoint: __gh_entrypoints.ERC20.v0_1.allowance,
      effect: spec.interfaces[0]!.methods[1]!.effect,
      args: [
        {
          abiName: "owner",
          publicName: "owner",
          type: spec.interfaces[0]!.methods[1]!.args[0]!.ty,
        },
        {
          abiName: "spender",
          publicName: "spender",
          type: spec.interfaces[0]!.methods[1]!.args[1]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[1]!.return_type,
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          name: "ERC20Error",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    deleteAllowance: __gh_client_contract.defineContractMethod<
      ERC20.v0_1.DeleteAllowanceArgs,
      ERC20.v0_1.DeleteAllowanceResult,
      ERC20.v0_1.DeclaredException
    >({
      interfaceName: "ERC20",
      interfaceVersion: "0.1.56",
      abiName: "delete_allowance",
      publicName: "deleteAllowance",
      entrypoint: __gh_entrypoints.ERC20.v0_1.deleteAllowance,
      effect: spec.interfaces[0]!.methods[2]!.effect,
      args: [
        {
          abiName: "spender",
          publicName: "spender",
          type: spec.interfaces[0]!.methods[2]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[2]!.return_type,
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          name: "ERC20Error",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    deleteBalance: __gh_client_contract.defineContractMethod<
      ERC20.v0_1.DeleteBalanceArgs,
      ERC20.v0_1.DeleteBalanceResult,
      ERC20.v0_1.DeclaredException
    >({
      interfaceName: "ERC20",
      interfaceVersion: "0.1.56",
      abiName: "delete_balance",
      publicName: "deleteBalance",
      entrypoint: __gh_entrypoints.ERC20.v0_1.deleteBalance,
      effect: spec.interfaces[0]!.methods[3]!.effect,
      args: [
      ],
      returnType: spec.interfaces[0]!.methods[3]!.return_type,
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          name: "ERC20Error",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    getBalance: __gh_client_contract.defineContractMethod<
      ERC20.v0_1.GetBalanceArgs,
      ERC20.v0_1.GetBalanceResult,
      ERC20.v0_1.DeclaredException
    >({
      interfaceName: "ERC20",
      interfaceVersion: "0.1.56",
      abiName: "get_balance",
      publicName: "getBalance",
      entrypoint: __gh_entrypoints.ERC20.v0_1.getBalance,
      effect: spec.interfaces[0]!.methods[4]!.effect,
      args: [
      ],
      returnType: spec.interfaces[0]!.methods[4]!.return_type,
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          name: "ERC20Error",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    getBalanceOf: __gh_client_contract.defineContractMethod<
      ERC20.v0_1.GetBalanceOfArgs,
      ERC20.v0_1.GetBalanceOfResult,
      ERC20.v0_1.DeclaredException
    >({
      interfaceName: "ERC20",
      interfaceVersion: "0.1.56",
      abiName: "get_balance_of",
      publicName: "getBalanceOf",
      entrypoint: __gh_entrypoints.ERC20.v0_1.getBalanceOf,
      effect: spec.interfaces[0]!.methods[5]!.effect,
      args: [
        {
          abiName: "addr",
          publicName: "addr",
          type: spec.interfaces[0]!.methods[5]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[5]!.return_type,
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          name: "ERC20Error",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    initialize: __gh_client_contract.defineContractMethod<
      ERC20.v0_1.InitializeArgs,
      ERC20.v0_1.InitializeResult,
      ERC20.v0_1.DeclaredException
    >({
      interfaceName: "ERC20",
      interfaceVersion: "0.1.56",
      abiName: "initialize",
      publicName: "initialize",
      entrypoint: __gh_entrypoints.ERC20.v0_1.initialize,
      effect: spec.interfaces[0]!.methods[6]!.effect,
      args: [
        {
          abiName: "administrator",
          publicName: "administrator",
          type: spec.interfaces[0]!.methods[6]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[6]!.return_type,
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          name: "ERC20Error",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    mint: __gh_client_contract.defineContractMethod<
      ERC20.v0_1.MintArgs,
      ERC20.v0_1.MintResult,
      ERC20.v0_1.DeclaredException
    >({
      interfaceName: "ERC20",
      interfaceVersion: "0.1.56",
      abiName: "mint",
      publicName: "mint",
      entrypoint: __gh_entrypoints.ERC20.v0_1.mint,
      effect: spec.interfaces[0]!.methods[7]!.effect,
      args: [
        {
          abiName: "receiver",
          publicName: "receiver",
          type: spec.interfaces[0]!.methods[7]!.args[0]!.ty,
        },
        {
          abiName: "amount",
          publicName: "amount",
          type: spec.interfaces[0]!.methods[7]!.args[1]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[7]!.return_type,
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          name: "ERC20Error",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    totalSupply: __gh_client_contract.defineContractMethod<
      ERC20.v0_1.TotalSupplyArgs,
      ERC20.v0_1.TotalSupplyResult,
      ERC20.v0_1.DeclaredException
    >({
      interfaceName: "ERC20",
      interfaceVersion: "0.1.56",
      abiName: "total_supply",
      publicName: "totalSupply",
      entrypoint: __gh_entrypoints.ERC20.v0_1.totalSupply,
      effect: spec.interfaces[0]!.methods[8]!.effect,
      args: [
      ],
      returnType: spec.interfaces[0]!.methods[8]!.return_type,
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          name: "ERC20Error",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    transfer: __gh_client_contract.defineContractMethod<
      ERC20.v0_1.TransferArgs,
      ERC20.v0_1.TransferResult,
      ERC20.v0_1.DeclaredException
    >({
      interfaceName: "ERC20",
      interfaceVersion: "0.1.56",
      abiName: "transfer",
      publicName: "transfer",
      entrypoint: __gh_entrypoints.ERC20.v0_1.transfer,
      effect: spec.interfaces[0]!.methods[9]!.effect,
      args: [
        {
          abiName: "receiver",
          publicName: "receiver",
          type: spec.interfaces[0]!.methods[9]!.args[0]!.ty,
        },
        {
          abiName: "amount",
          publicName: "amount",
          type: spec.interfaces[0]!.methods[9]!.args[1]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[9]!.return_type,
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          name: "ERC20Error",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    transferFrom: __gh_client_contract.defineContractMethod<
      ERC20.v0_1.TransferFromArgs,
      ERC20.v0_1.TransferFromResult,
      ERC20.v0_1.DeclaredException
    >({
      interfaceName: "ERC20",
      interfaceVersion: "0.1.56",
      abiName: "transfer_from",
      publicName: "transferFrom",
      entrypoint: __gh_entrypoints.ERC20.v0_1.transferFrom,
      effect: spec.interfaces[0]!.methods[10]!.effect,
      args: [
        {
          abiName: "owner",
          publicName: "owner",
          type: spec.interfaces[0]!.methods[10]!.args[0]!.ty,
        },
        {
          abiName: "receiver",
          publicName: "receiver",
          type: spec.interfaces[0]!.methods[10]!.args[1]!.ty,
        },
        {
          abiName: "amount",
          publicName: "amount",
          type: spec.interfaces[0]!.methods[10]!.args[2]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[10]!.return_type,
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          name: "ERC20Error",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
  },
} as const;

export const ERC20Metadata = {
  v0_1: {
    decimals: __gh_client_contract.defineContractMethod<
      ERC20Metadata.v0_1.DecimalsArgs,
      ERC20Metadata.v0_1.DecimalsResult,
      ERC20Metadata.v0_1.DeclaredException
    >({
      interfaceName: "ERC20Metadata",
      interfaceVersion: "0.1.56",
      abiName: "decimals",
      publicName: "decimals",
      entrypoint: __gh_entrypoints.ERC20Metadata.v0_1.decimals,
      effect: spec.interfaces[1]!.methods[0]!.effect,
      args: [
      ],
      returnType: spec.interfaces[1]!.methods[0]!.return_type,
      throws: [
      ],
      codecs: __gh_codecs,
    }),
    initialize: __gh_client_contract.defineContractMethod<
      ERC20Metadata.v0_1.InitializeArgs,
      ERC20Metadata.v0_1.InitializeResult,
      ERC20Metadata.v0_1.DeclaredException
    >({
      interfaceName: "ERC20Metadata",
      interfaceVersion: "0.1.56",
      abiName: "initialize",
      publicName: "initialize",
      entrypoint: __gh_entrypoints.ERC20Metadata.v0_1.initialize,
      effect: spec.interfaces[1]!.methods[1]!.effect,
      args: [
        {
          abiName: "administrator",
          publicName: "administrator",
          type: spec.interfaces[1]!.methods[1]!.args[0]!.ty,
        },
        {
          abiName: "name",
          publicName: "name",
          type: spec.interfaces[1]!.methods[1]!.args[1]!.ty,
        },
        {
          abiName: "symbol",
          publicName: "symbol",
          type: spec.interfaces[1]!.methods[1]!.args[2]!.ty,
        },
        {
          abiName: "decimals",
          publicName: "decimals",
          type: spec.interfaces[1]!.methods[1]!.args[3]!.ty,
        },
      ],
      returnType: spec.interfaces[1]!.methods[1]!.return_type,
      throws: [
      ],
      codecs: __gh_codecs,
    }),
    name: __gh_client_contract.defineContractMethod<
      ERC20Metadata.v0_1.NameArgs,
      ERC20Metadata.v0_1.NameResult,
      ERC20Metadata.v0_1.DeclaredException
    >({
      interfaceName: "ERC20Metadata",
      interfaceVersion: "0.1.56",
      abiName: "name",
      publicName: "name",
      entrypoint: __gh_entrypoints.ERC20Metadata.v0_1.name,
      effect: spec.interfaces[1]!.methods[2]!.effect,
      args: [
      ],
      returnType: spec.interfaces[1]!.methods[2]!.return_type,
      throws: [
      ],
      codecs: __gh_codecs,
    }),
    symbol: __gh_client_contract.defineContractMethod<
      ERC20Metadata.v0_1.SymbolArgs,
      ERC20Metadata.v0_1.SymbolResult,
      ERC20Metadata.v0_1.DeclaredException
    >({
      interfaceName: "ERC20Metadata",
      interfaceVersion: "0.1.56",
      abiName: "symbol",
      publicName: "symbol",
      entrypoint: __gh_entrypoints.ERC20Metadata.v0_1.symbol,
      effect: spec.interfaces[1]!.methods[3]!.effect,
      args: [
      ],
      returnType: spec.interfaces[1]!.methods[3]!.return_type,
      throws: [
      ],
      codecs: __gh_codecs,
    }),
  },
} as const;

export const KalienTokenAdmin = {
  v0_1: {
    administrator: __gh_client_contract.defineContractMethod<
      KalienTokenAdmin.v0_1.AdministratorArgs,
      KalienTokenAdmin.v0_1.AdministratorResult,
      KalienTokenAdmin.v0_1.DeclaredException
    >({
      interfaceName: "KalienTokenAdmin",
      interfaceVersion: "0.1.0",
      abiName: "administrator",
      publicName: "administrator",
      entrypoint: __gh_entrypoints.KalienTokenAdmin.v0_1.administrator,
      effect: spec.interfaces[2]!.methods[0]!.effect,
      args: [
      ],
      returnType: spec.interfaces[2]!.methods[0]!.return_type,
      throws: [
        {
          selector: 0x10f34552a2821e8an,
          name: "KalienTokenError",
          type: spec.interfaces[2]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    setAdministrator: __gh_client_contract.defineContractMethod<
      KalienTokenAdmin.v0_1.SetAdministratorArgs,
      KalienTokenAdmin.v0_1.SetAdministratorResult,
      KalienTokenAdmin.v0_1.DeclaredException
    >({
      interfaceName: "KalienTokenAdmin",
      interfaceVersion: "0.1.0",
      abiName: "set_administrator",
      publicName: "setAdministrator",
      entrypoint: __gh_entrypoints.KalienTokenAdmin.v0_1.setAdministrator,
      effect: spec.interfaces[2]!.methods[1]!.effect,
      args: [
        {
          abiName: "administrator",
          publicName: "administrator",
          type: spec.interfaces[2]!.methods[1]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[2]!.methods[1]!.return_type,
      throws: [
        {
          selector: 0x10f34552a2821e8an,
          name: "KalienTokenError",
          type: spec.interfaces[2]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
  },
} as const;

export const kalien_token = {
  v0_1: {
    implementation: {
      AdministratorChanged: __gh_client_contract.defineContractEvent<
        "AdministratorChanged",
        kalien_token.v0_1.implementation.AdministratorChanged["topics"],
        kalien_token.v0_1.implementation.AdministratorChanged["fields"],
        kalien_token.v0_1.implementation.AdministratorChangedFilter
      >({
        name: "AdministratorChanged",
        signature: spec.events[0]!.signature,
        topics: [
          {
            name: "previous",
            type: spec.events[0]!.topics[0]!.ty,
            representation: "address",
          },
          {
            name: "administrator",
            type: spec.events[0]!.topics[1]!.ty,
            representation: "address",
          },
        ],
        fields: [
        ],
        codecs: __gh_codecs,
      }),
      KalienTokenError: {
        "NotAdministrator": 1n,
      },
    },
  },
} as const;

export const thruput_erc20_if = {
  v0_1: {
    error: {
      ERC20Error: {
        "AlreadyInitialized": 1n,
        "MustBeContractOwner": 2n,
        "TooLarge": 3n,
        "BalanceNotZero": 4n,
        "NegativeAmount": 5n,
        "Internal": 100n,
      },
    },
    events: {
      AllowanceChangeEvent: __gh_client_contract.defineContractEvent<
        "AllowanceChangeEvent",
        thruput_erc20_if.v0_1.events.AllowanceChangeEvent["topics"],
        thruput_erc20_if.v0_1.events.AllowanceChangeEvent["fields"],
        thruput_erc20_if.v0_1.events.AllowanceChangeEventFilter
      >({
        name: "AllowanceChangeEvent",
        signature: spec.events[1]!.signature,
        topics: [
          {
            name: "owner",
            type: spec.events[1]!.topics[0]!.ty,
            representation: "address",
          },
          {
            name: "spender",
            type: spec.events[1]!.topics[1]!.ty,
            representation: "address",
          },
        ],
        fields: [
          { name: "difference", type: spec.events[1]!.fields[0]!.ty },
        ],
        codecs: __gh_codecs,
      }),
      AllowanceDeleteEvent: __gh_client_contract.defineContractEvent<
        "AllowanceDeleteEvent",
        thruput_erc20_if.v0_1.events.AllowanceDeleteEvent["topics"],
        thruput_erc20_if.v0_1.events.AllowanceDeleteEvent["fields"],
        thruput_erc20_if.v0_1.events.AllowanceDeleteEventFilter
      >({
        name: "AllowanceDeleteEvent",
        signature: spec.events[2]!.signature,
        topics: [
          {
            name: "owner",
            type: spec.events[2]!.topics[0]!.ty,
            representation: "address",
          },
          {
            name: "spender",
            type: spec.events[2]!.topics[1]!.ty,
            representation: "address",
          },
        ],
        fields: [
          { name: "removed", type: spec.events[2]!.fields[0]!.ty },
        ],
        codecs: __gh_codecs,
      }),
      MintEvent: __gh_client_contract.defineContractEvent<
        "MintEvent",
        thruput_erc20_if.v0_1.events.MintEvent["topics"],
        thruput_erc20_if.v0_1.events.MintEvent["fields"],
        thruput_erc20_if.v0_1.events.MintEventFilter
      >({
        name: "MintEvent",
        signature: spec.events[3]!.signature,
        topics: [
          {
            name: "to",
            type: spec.events[3]!.topics[0]!.ty,
            representation: "address",
          },
        ],
        fields: [
          { name: "amount", type: spec.events[3]!.fields[0]!.ty },
        ],
        codecs: __gh_codecs,
      }),
      TransferEvent: __gh_client_contract.defineContractEvent<
        "TransferEvent",
        thruput_erc20_if.v0_1.events.TransferEvent["topics"],
        thruput_erc20_if.v0_1.events.TransferEvent["fields"],
        thruput_erc20_if.v0_1.events.TransferEventFilter
      >({
        name: "TransferEvent",
        signature: spec.events[4]!.signature,
        topics: [
          {
            name: "from",
            type: spec.events[4]!.topics[0]!.ty,
            representation: "address",
          },
          {
            name: "to",
            type: spec.events[4]!.topics[1]!.ty,
            representation: "address",
          },
        ],
        fields: [
          { name: "amount", type: spec.events[4]!.fields[0]!.ty },
        ],
        codecs: __gh_codecs,
      }),
    },
  },
} as const;

export type ERC20Event = kalien_token.v0_1.implementation.AdministratorChanged | thruput_erc20_if.v0_1.events.AllowanceChangeEvent | thruput_erc20_if.v0_1.events.AllowanceDeleteEvent | thruput_erc20_if.v0_1.events.MintEvent | thruput_erc20_if.v0_1.events.TransferEvent;

export function decodeEvent(__gh_event: { topics: globalThis.Uint8Array[]; data: globalThis.Uint8Array }): ERC20Event | null {
  return kalien_token.v0_1.implementation.AdministratorChanged.decode(__gh_event) ?? thruput_erc20_if.v0_1.events.AllowanceChangeEvent.decode(__gh_event) ?? thruput_erc20_if.v0_1.events.AllowanceDeleteEvent.decode(__gh_event) ?? thruput_erc20_if.v0_1.events.MintEvent.decode(__gh_event) ?? thruput_erc20_if.v0_1.events.TransferEvent.decode(__gh_event);
}

// The types the namespaces above refer to, under names no declaration can capture.
export namespace __gh_codegen {
  export type kalien_token$v0_1$implementation$KalienTokenError = kalien_token.v0_1.implementation.KalienTokenError;
  export type thruput_erc20_if$v0_1$error$ERC20Error = thruput_erc20_if.v0_1.error.ERC20Error;
}
