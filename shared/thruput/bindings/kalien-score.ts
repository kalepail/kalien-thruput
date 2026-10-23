// Generated from kalien_score.spec.xdr - KalienScore interface v0.1.0
// DO NOT EDIT. Re-run codegen to update.

import * as __gh_protocol from "@thruputchain/protocol";
import * as __gh_protocol_utils from "@thruputchain/protocol/utils";
import * as __gh_contract_spec from "@thruputchain/contract-spec";
import * as __gh_client_contract from "@thruputchain/client/contract";

const __gh_s = __gh_contract_spec.contractSpecString;

const __gh_entrypoints = {
  KalienScore: {
    v0_1: {
      bestScore: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("699115ff457047b6")),
      claimMessage: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("73a29e934f192600")),
      config: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("990c283a540f6eac")),
      currentSeed: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("8e2e8f0664660c40")),
      currentSeedId: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("8d61bd2181e21b64")),
      ensureCurrentSeed: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("632c2ceffd1b7dcc")),
      initialize: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("78deddfca2e9d13c")),
      isClaimed: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("af5f307c6b21a06d")),
      isRelay: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("cca053e9911fa235")),
      isSeedActive: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("f5299c273338cbdb")),
      lockSeeding: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("2eff8e01c5761e1f")),
      playerAddress: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("c0f3d5d78d0e846d")),
      seed: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("326d168f4ee37c2b")),
      setAdmin: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("66447ca062fc95ab")),
      setPaused: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("074d6550d1255a2d")),
      setRelay: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("3868941bad4c5746")),
      setRelayOnly: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("a9426b47ed2e2ec3")),
      setSeed: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("438c2d7b2e60fdab")),
      submitScore: __gh_protocol.contractEntrypointID(__gh_protocol_utils.fromHex("91239f105b22814d")),
    },
  },
} as const;

export namespace kalien_score {

  export namespace v0_1 {

    export namespace implementation {

      export interface Config { "admin": __gh_protocol.ContractAddress; "token": __gh_protocol.ContractAddress; "paused": boolean; "relay_only": boolean; "seeding_locked": boolean; }

      export type ScoreError = 1n | 2n | 3n | 4n | 5n | 6n | 7n | 8n | 9n | 10n | 11n | 12n | 13n | 14n | 20n | 21n | 22n | 23n | 24n | 25n | 26n | 27n | 28n | 30n | 31n | 32n;

      export interface ScoreReceipt { "player": __gh_protocol.ContractAddress; "seed_id": bigint; "seed": bigint; "frame_count": bigint; "final_score": bigint; "previous_best": bigint; "minted_delta": bigint; "tape_hash": __gh_client_contract.FixedBytes<32>; }

      export interface SeedInfo { "seed_id": bigint; "seed": bigint; }

      export interface AdminChanged extends __gh_client_contract.DecodedContractEvent<
        "AdminChanged",
        { "previous": __gh_protocol.ContractAddress; "admin": __gh_protocol.ContractAddress },
        {  }
      > {}

      export interface AdminChangedFilter {
        "previous"?: __gh_client_contract.ContractEventFilterValue<__gh_protocol.ContractAddress>;
        "admin"?: __gh_client_contract.ContractEventFilterValue<__gh_protocol.ContractAddress>;
      }

      export interface RelayChanged extends __gh_client_contract.DecodedContractEvent<
        "RelayChanged",
        { "relay": __gh_protocol.ContractAddress },
        { "allowed": boolean }
      > {}

      export interface RelayChangedFilter {
        "relay"?: __gh_client_contract.ContractEventFilterValue<__gh_protocol.ContractAddress>;
      }

      export interface ScoreSubmitted extends __gh_client_contract.DecodedContractEvent<
        "ScoreSubmitted",
        { "player": __gh_protocol.ContractAddress; "seed_id": bigint },
        { "player_pubkey": __gh_client_contract.FixedBytes<32>; "seed": bigint; "frame_count": bigint; "final_score": bigint; "previous_best": bigint; "new_best": bigint; "minted_delta": bigint; "tape_hash": __gh_client_contract.FixedBytes<32> }
      > {}

      export interface ScoreSubmittedFilter {
        "player"?: __gh_client_contract.ContractEventFilterValue<__gh_protocol.ContractAddress>;
        "seed_id"?: __gh_client_contract.ContractEventFilterValue<bigint>;
      }

      export interface SeedCreated extends __gh_client_contract.DecodedContractEvent<
        "SeedCreated",
        { "seed_id": bigint },
        { "seed": bigint }
      > {}

      export interface SeedCreatedFilter {
        "seed_id"?: __gh_client_contract.ContractEventFilterValue<bigint>;
      }

      export interface SettingsChanged extends __gh_client_contract.DecodedContractEvent<
        "SettingsChanged",
        {  },
        { "paused": boolean; "relay_only": boolean; "seeding_locked": boolean }
      > {}

      export type SettingsChangedFilter = globalThis.Record<string, never>;
    }
  }
}

export namespace KalienScore {

  export namespace v0_1 {

    export interface BestScoreArgs {
      player: __gh_protocol.ContractAddress;
      seedId: bigint;
    }
    export type BestScoreResult = bigint;

    export interface ClaimMessageArgs {
      seedId: bigint;
      tapeHash: __gh_client_contract.FixedBytes<32>;
    }
    export type ClaimMessageResult = __gh_client_contract.FixedBytes<32>;

    export type ConfigArgs = void;
    export type ConfigResult = __gh_codegen.kalien_score$v0_1$implementation$Config;

    export type CurrentSeedArgs = void;
    export type CurrentSeedResult = __gh_codegen.kalien_score$v0_1$implementation$SeedInfo | null;

    export type CurrentSeedIdArgs = void;
    export type CurrentSeedIdResult = bigint;

    export type EnsureCurrentSeedArgs = void;
    export type EnsureCurrentSeedResult = __gh_codegen.kalien_score$v0_1$implementation$SeedInfo;

    export interface InitializeArgs {
      admin: __gh_protocol.ContractAddress;
      token: __gh_protocol.ContractAddress;
    }
    export type InitializeResult = void;

    export interface IsClaimedArgs {
      tapeHash: __gh_client_contract.FixedBytes<32>;
    }
    export type IsClaimedResult = boolean;

    export interface IsRelayArgs {
      relay: __gh_protocol.ContractAddress;
    }
    export type IsRelayResult = boolean;

    export interface IsSeedActiveArgs {
      seedId: bigint;
    }
    export type IsSeedActiveResult = boolean;

    export type LockSeedingArgs = void;
    export type LockSeedingResult = void;

    export interface PlayerAddressArgs {
      playerPubkey: __gh_client_contract.FixedBytes<32>;
    }
    export type PlayerAddressResult = __gh_protocol.ContractAddress;

    export interface SeedArgs {
      seedId: bigint;
    }
    export type SeedResult = bigint | null;

    export interface SetAdminArgs {
      admin: __gh_protocol.ContractAddress;
    }
    export type SetAdminResult = void;

    export interface SetPausedArgs {
      paused: boolean;
    }
    export type SetPausedResult = void;

    export interface SetRelayArgs {
      relay: __gh_protocol.ContractAddress;
      allowed: boolean;
    }
    export type SetRelayResult = void;

    export interface SetRelayOnlyArgs {
      relayOnly: boolean;
    }
    export type SetRelayOnlyResult = void;

    export interface SetSeedArgs {
      seedId: bigint;
      seed: bigint;
    }
    export type SetSeedResult = void;

    export interface SubmitScoreArgs {
      playerPubkey: __gh_client_contract.FixedBytes<32>;
      seedId: bigint;
      tape: globalThis.Uint8Array;
      signature: __gh_client_contract.FixedBytes<64>;
    }
    export type SubmitScoreResult = __gh_codegen.kalien_score$v0_1$implementation$ScoreReceipt;

    export type DeclaredException =
      {
        kind: "declared";
        name: "ScoreError";
        selector: 0xdf1e219a979853c7n;
        value: __gh_codegen.kalien_score$v0_1$implementation$ScoreError;
      };
    export type Exception = __gh_client_contract.ContractException<DeclaredException>;
  }
}

export const spec: __gh_client_contract.ContractSpec = {
  interfaces: [
    {
      name: __gh_s("KalienScore"),
      vers: __gh_s("0.1.0"),
      throws: [
        { selector: 0xdf1e219a979853c7n, ty: { v: __gh_contract_spec.ContractTypeKind.Named, named: { crate_name: __gh_s("kalien_score"), major: __gh_s("0.1"), module_path: __gh_s("kalien_score::implementation"), declared: __gh_s("ScoreError") } } },
      ],
      methods: [
        {
          name: __gh_s("best_score"),
          args: [
            { name: __gh_s("player"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
            { name: __gh_s("seed_id"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.U32 },
          effect: null,
        },
        {
          name: __gh_s("claim_message"),
          args: [
            { name: __gh_s("seed_id"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
            { name: __gh_s("tape_hash"), ty: { v: __gh_contract_spec.ContractTypeKind.Array, array: { element: { v: __gh_contract_spec.ContractTypeKind.U8 }, len: 32n } } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Array, array: { element: { v: __gh_contract_spec.ContractTypeKind.U8 }, len: 32n } },
          effect: null,
        },
        {
          name: __gh_s("config"),
          args: [
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Named, named: { crate_name: __gh_s("kalien_score"), major: __gh_s("0.1"), module_path: __gh_s("kalien_score::implementation"), declared: __gh_s("Config") } },
          effect: null,
        },
        {
          name: __gh_s("current_seed"),
          args: [
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Option, option_inner: { v: __gh_contract_spec.ContractTypeKind.Named, named: { crate_name: __gh_s("kalien_score"), major: __gh_s("0.1"), module_path: __gh_s("kalien_score::implementation"), declared: __gh_s("SeedInfo") } } },
          effect: null,
        },
        {
          name: __gh_s("current_seed_id"),
          args: [
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.U32 },
          effect: null,
        },
        {
          name: __gh_s("ensure_current_seed"),
          args: [
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Named, named: { crate_name: __gh_s("kalien_score"), major: __gh_s("0.1"), module_path: __gh_s("kalien_score::implementation"), declared: __gh_s("SeedInfo") } },
          effect: null,
        },
        {
          name: __gh_s("initialize"),
          args: [
            { name: __gh_s("admin"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
            { name: __gh_s("token"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("is_claimed"),
          args: [
            { name: __gh_s("tape_hash"), ty: { v: __gh_contract_spec.ContractTypeKind.Array, array: { element: { v: __gh_contract_spec.ContractTypeKind.U8 }, len: 32n } } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Bool },
          effect: null,
        },
        {
          name: __gh_s("is_relay"),
          args: [
            { name: __gh_s("relay"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Bool },
          effect: null,
        },
        {
          name: __gh_s("is_seed_active"),
          args: [
            { name: __gh_s("seed_id"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Bool },
          effect: null,
        },
        {
          name: __gh_s("lock_seeding"),
          args: [
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("player_address"),
          args: [
            { name: __gh_s("player_pubkey"), ty: { v: __gh_contract_spec.ContractTypeKind.Array, array: { element: { v: __gh_contract_spec.ContractTypeKind.U8 }, len: 32n } } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Address },
          effect: null,
        },
        {
          name: __gh_s("seed"),
          args: [
            { name: __gh_s("seed_id"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Option, option_inner: { v: __gh_contract_spec.ContractTypeKind.U32 } },
          effect: null,
        },
        {
          name: __gh_s("set_admin"),
          args: [
            { name: __gh_s("admin"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("set_paused"),
          args: [
            { name: __gh_s("paused"), ty: { v: __gh_contract_spec.ContractTypeKind.Bool } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("set_relay"),
          args: [
            { name: __gh_s("relay"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
            { name: __gh_s("allowed"), ty: { v: __gh_contract_spec.ContractTypeKind.Bool } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("set_relay_only"),
          args: [
            { name: __gh_s("relay_only"), ty: { v: __gh_contract_spec.ContractTypeKind.Bool } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("set_seed"),
          args: [
            { name: __gh_s("seed_id"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
            { name: __gh_s("seed"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("submit_score"),
          args: [
            { name: __gh_s("player_pubkey"), ty: { v: __gh_contract_spec.ContractTypeKind.Array, array: { element: { v: __gh_contract_spec.ContractTypeKind.U8 }, len: 32n } } },
            { name: __gh_s("seed_id"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
            { name: __gh_s("tape"), ty: { v: __gh_contract_spec.ContractTypeKind.Vector, vector: { element: { v: __gh_contract_spec.ContractTypeKind.U8 }, max_len: 4294967295n } } },
            { name: __gh_s("signature"), ty: { v: __gh_contract_spec.ContractTypeKind.Array, array: { element: { v: __gh_contract_spec.ContractTypeKind.U8 }, len: 64n } } },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Named, named: { crate_name: __gh_s("kalien_score"), major: __gh_s("0.1"), module_path: __gh_s("kalien_score::implementation"), declared: __gh_s("ScoreReceipt") } },
          effect: null,
        },
      ],
    },
  ],
  type_defs: [
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefStruct,
      struct_def: {
        name: { crate_name: __gh_s("kalien_score"), major: __gh_s("0.1"), module_path: __gh_s("kalien_score::implementation"), declared: __gh_s("Config") },
        fields: [
          { name: __gh_s("admin"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
          { name: __gh_s("token"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
          { name: __gh_s("paused"), ty: { v: __gh_contract_spec.ContractTypeKind.Bool } },
          { name: __gh_s("relay_only"), ty: { v: __gh_contract_spec.ContractTypeKind.Bool } },
          { name: __gh_s("seeding_locked"), ty: { v: __gh_contract_spec.ContractTypeKind.Bool } },
        ],
      },
    },
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefEnum,
      enum_def: {
        name: { crate_name: __gh_s("kalien_score"), major: __gh_s("0.1"), module_path: __gh_s("kalien_score::implementation"), declared: __gh_s("ScoreError") },
        variants: [
          { name: __gh_s("AlreadyInitialized"), value: 1n },
          { name: __gh_s("NotAdmin"), value: 2n },
          { name: __gh_s("Paused"), value: 3n },
          { name: __gh_s("UnknownSeed"), value: 4n },
          { name: __gh_s("SeedInactive"), value: 5n },
          { name: __gh_s("SeedMismatch"), value: 6n },
          { name: __gh_s("BadSignature"), value: 7n },
          { name: __gh_s("AlreadyClaimed"), value: 8n },
          { name: __gh_s("ZeroScore"), value: 9n },
          { name: __gh_s("NotImproved"), value: 10n },
          { name: __gh_s("SeedAlreadySet"), value: 11n },
          { name: __gh_s("ZeroSeed"), value: 12n },
          { name: __gh_s("SeedingLocked"), value: 13n },
          { name: __gh_s("NotRelay"), value: 14n },
          { name: __gh_s("TapeTooShort"), value: 20n },
          { name: __gh_s("TapeBadMagic"), value: 21n },
          { name: __gh_s("TapeBadVersion"), value: 22n },
          { name: __gh_s("TapeBadRulesTag"), value: 23n },
          { name: __gh_s("TapeReservedNonZero"), value: 24n },
          { name: __gh_s("TapeFrameCountOutOfRange"), value: 25n },
          { name: __gh_s("TapeLengthMismatch"), value: 26n },
          { name: __gh_s("TapeCrcMismatch"), value: 27n },
          { name: __gh_s("TapeBadPadding"), value: 28n },
          { name: __gh_s("RuleViolation"), value: 30n },
          { name: __gh_s("FrameCountMismatch"), value: 31n },
          { name: __gh_s("ScoreMismatch"), value: 32n },
        ],
      },
    },
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefStruct,
      struct_def: {
        name: { crate_name: __gh_s("kalien_score"), major: __gh_s("0.1"), module_path: __gh_s("kalien_score::implementation"), declared: __gh_s("ScoreReceipt") },
        fields: [
          { name: __gh_s("player"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
          { name: __gh_s("seed_id"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
          { name: __gh_s("seed"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
          { name: __gh_s("frame_count"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
          { name: __gh_s("final_score"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
          { name: __gh_s("previous_best"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
          { name: __gh_s("minted_delta"), ty: { v: __gh_contract_spec.ContractTypeKind.I128 } },
          { name: __gh_s("tape_hash"), ty: { v: __gh_contract_spec.ContractTypeKind.Array, array: { element: { v: __gh_contract_spec.ContractTypeKind.U8 }, len: 32n } } },
        ],
      },
    },
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefStruct,
      struct_def: {
        name: { crate_name: __gh_s("kalien_score"), major: __gh_s("0.1"), module_path: __gh_s("kalien_score::implementation"), declared: __gh_s("SeedInfo") },
        fields: [
          { name: __gh_s("seed_id"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
          { name: __gh_s("seed"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
        ],
      },
    },
  ],
  events: [
    {
      name: { crate_name: __gh_s("kalien_score"), major: __gh_s("0.1"), module_path: __gh_s("kalien_score::implementation"), declared: __gh_s("AdminChanged") },
      signature: __gh_protocol.topic(__gh_protocol_utils.fromHex("c16735adc736fed453c3c542216bd71393e00faefbe2c49ef7c4de5727521da2")),
      topics: [
        { name: __gh_s("previous"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
        { name: __gh_s("admin"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
      ],
      fields: [
      ],
    },
    {
      name: { crate_name: __gh_s("kalien_score"), major: __gh_s("0.1"), module_path: __gh_s("kalien_score::implementation"), declared: __gh_s("RelayChanged") },
      signature: __gh_protocol.topic(__gh_protocol_utils.fromHex("3035f3ba0b8714be34e4fe839d9d8d7dff4444eb82b4d4724a8e2ddfa6292daa")),
      topics: [
        { name: __gh_s("relay"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
      ],
      fields: [
        { name: __gh_s("allowed"), ty: { v: __gh_contract_spec.ContractTypeKind.Bool } },
      ],
    },
    {
      name: { crate_name: __gh_s("kalien_score"), major: __gh_s("0.1"), module_path: __gh_s("kalien_score::implementation"), declared: __gh_s("ScoreSubmitted") },
      signature: __gh_protocol.topic(__gh_protocol_utils.fromHex("860c2085df9bdb294caaa26f0d591a2d85a75eb05ac0a18f182896ddb2961ab7")),
      topics: [
        { name: __gh_s("player"), ty: { v: __gh_contract_spec.ContractTypeKind.Address } },
        { name: __gh_s("seed_id"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
      ],
      fields: [
        { name: __gh_s("player_pubkey"), ty: { v: __gh_contract_spec.ContractTypeKind.Array, array: { element: { v: __gh_contract_spec.ContractTypeKind.U8 }, len: 32n } } },
        { name: __gh_s("seed"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
        { name: __gh_s("frame_count"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
        { name: __gh_s("final_score"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
        { name: __gh_s("previous_best"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
        { name: __gh_s("new_best"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
        { name: __gh_s("minted_delta"), ty: { v: __gh_contract_spec.ContractTypeKind.I128 } },
        { name: __gh_s("tape_hash"), ty: { v: __gh_contract_spec.ContractTypeKind.Array, array: { element: { v: __gh_contract_spec.ContractTypeKind.U8 }, len: 32n } } },
      ],
    },
    {
      name: { crate_name: __gh_s("kalien_score"), major: __gh_s("0.1"), module_path: __gh_s("kalien_score::implementation"), declared: __gh_s("SeedCreated") },
      signature: __gh_protocol.topic(__gh_protocol_utils.fromHex("7ce7792e5812c6c27c4e25a1e07340871cd54e7eb97e1c36d7f5ca39680f1688")),
      topics: [
        { name: __gh_s("seed_id"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
      ],
      fields: [
        { name: __gh_s("seed"), ty: { v: __gh_contract_spec.ContractTypeKind.U32 } },
      ],
    },
    {
      name: { crate_name: __gh_s("kalien_score"), major: __gh_s("0.1"), module_path: __gh_s("kalien_score::implementation"), declared: __gh_s("SettingsChanged") },
      signature: __gh_protocol.topic(__gh_protocol_utils.fromHex("7bce6189830df2a295f0f21bbc7d014154d1f8ec82ff1f923b168ae9f8affe99")),
      topics: [
      ],
      fields: [
        { name: __gh_s("paused"), ty: { v: __gh_contract_spec.ContractTypeKind.Bool } },
        { name: __gh_s("relay_only"), ty: { v: __gh_contract_spec.ContractTypeKind.Bool } },
        { name: __gh_s("seeding_locked"), ty: { v: __gh_contract_spec.ContractTypeKind.Bool } },
      ],
    },
  ],
};

const __gh_codecs = __gh_client_contract.createContractCodecContext(spec.type_defs);

export const KalienScore = {
  v0_1: {
    bestScore: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.BestScoreArgs,
      KalienScore.v0_1.BestScoreResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "best_score",
      publicName: "bestScore",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.bestScore,
      effect: spec.interfaces[0]!.methods[0]!.effect,
      args: [
        {
          abiName: "player",
          publicName: "player",
          type: spec.interfaces[0]!.methods[0]!.args[0]!.ty,
        },
        {
          abiName: "seed_id",
          publicName: "seedId",
          type: spec.interfaces[0]!.methods[0]!.args[1]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[0]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    claimMessage: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.ClaimMessageArgs,
      KalienScore.v0_1.ClaimMessageResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "claim_message",
      publicName: "claimMessage",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.claimMessage,
      effect: spec.interfaces[0]!.methods[1]!.effect,
      args: [
        {
          abiName: "seed_id",
          publicName: "seedId",
          type: spec.interfaces[0]!.methods[1]!.args[0]!.ty,
        },
        {
          abiName: "tape_hash",
          publicName: "tapeHash",
          type: spec.interfaces[0]!.methods[1]!.args[1]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[1]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    config: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.ConfigArgs,
      KalienScore.v0_1.ConfigResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "config",
      publicName: "config",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.config,
      effect: spec.interfaces[0]!.methods[2]!.effect,
      args: [
      ],
      returnType: spec.interfaces[0]!.methods[2]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    currentSeed: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.CurrentSeedArgs,
      KalienScore.v0_1.CurrentSeedResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "current_seed",
      publicName: "currentSeed",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.currentSeed,
      effect: spec.interfaces[0]!.methods[3]!.effect,
      args: [
      ],
      returnType: spec.interfaces[0]!.methods[3]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    currentSeedId: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.CurrentSeedIdArgs,
      KalienScore.v0_1.CurrentSeedIdResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "current_seed_id",
      publicName: "currentSeedId",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.currentSeedId,
      effect: spec.interfaces[0]!.methods[4]!.effect,
      args: [
      ],
      returnType: spec.interfaces[0]!.methods[4]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    ensureCurrentSeed: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.EnsureCurrentSeedArgs,
      KalienScore.v0_1.EnsureCurrentSeedResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "ensure_current_seed",
      publicName: "ensureCurrentSeed",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.ensureCurrentSeed,
      effect: spec.interfaces[0]!.methods[5]!.effect,
      args: [
      ],
      returnType: spec.interfaces[0]!.methods[5]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    initialize: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.InitializeArgs,
      KalienScore.v0_1.InitializeResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "initialize",
      publicName: "initialize",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.initialize,
      effect: spec.interfaces[0]!.methods[6]!.effect,
      args: [
        {
          abiName: "admin",
          publicName: "admin",
          type: spec.interfaces[0]!.methods[6]!.args[0]!.ty,
        },
        {
          abiName: "token",
          publicName: "token",
          type: spec.interfaces[0]!.methods[6]!.args[1]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[6]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    isClaimed: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.IsClaimedArgs,
      KalienScore.v0_1.IsClaimedResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "is_claimed",
      publicName: "isClaimed",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.isClaimed,
      effect: spec.interfaces[0]!.methods[7]!.effect,
      args: [
        {
          abiName: "tape_hash",
          publicName: "tapeHash",
          type: spec.interfaces[0]!.methods[7]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[7]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    isRelay: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.IsRelayArgs,
      KalienScore.v0_1.IsRelayResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "is_relay",
      publicName: "isRelay",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.isRelay,
      effect: spec.interfaces[0]!.methods[8]!.effect,
      args: [
        {
          abiName: "relay",
          publicName: "relay",
          type: spec.interfaces[0]!.methods[8]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[8]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    isSeedActive: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.IsSeedActiveArgs,
      KalienScore.v0_1.IsSeedActiveResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "is_seed_active",
      publicName: "isSeedActive",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.isSeedActive,
      effect: spec.interfaces[0]!.methods[9]!.effect,
      args: [
        {
          abiName: "seed_id",
          publicName: "seedId",
          type: spec.interfaces[0]!.methods[9]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[9]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    lockSeeding: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.LockSeedingArgs,
      KalienScore.v0_1.LockSeedingResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "lock_seeding",
      publicName: "lockSeeding",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.lockSeeding,
      effect: spec.interfaces[0]!.methods[10]!.effect,
      args: [
      ],
      returnType: spec.interfaces[0]!.methods[10]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    playerAddress: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.PlayerAddressArgs,
      KalienScore.v0_1.PlayerAddressResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "player_address",
      publicName: "playerAddress",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.playerAddress,
      effect: spec.interfaces[0]!.methods[11]!.effect,
      args: [
        {
          abiName: "player_pubkey",
          publicName: "playerPubkey",
          type: spec.interfaces[0]!.methods[11]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[11]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    seed: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.SeedArgs,
      KalienScore.v0_1.SeedResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "seed",
      publicName: "seed",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.seed,
      effect: spec.interfaces[0]!.methods[12]!.effect,
      args: [
        {
          abiName: "seed_id",
          publicName: "seedId",
          type: spec.interfaces[0]!.methods[12]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[12]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    setAdmin: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.SetAdminArgs,
      KalienScore.v0_1.SetAdminResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "set_admin",
      publicName: "setAdmin",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.setAdmin,
      effect: spec.interfaces[0]!.methods[13]!.effect,
      args: [
        {
          abiName: "admin",
          publicName: "admin",
          type: spec.interfaces[0]!.methods[13]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[13]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    setPaused: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.SetPausedArgs,
      KalienScore.v0_1.SetPausedResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "set_paused",
      publicName: "setPaused",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.setPaused,
      effect: spec.interfaces[0]!.methods[14]!.effect,
      args: [
        {
          abiName: "paused",
          publicName: "paused",
          type: spec.interfaces[0]!.methods[14]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[14]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    setRelay: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.SetRelayArgs,
      KalienScore.v0_1.SetRelayResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "set_relay",
      publicName: "setRelay",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.setRelay,
      effect: spec.interfaces[0]!.methods[15]!.effect,
      args: [
        {
          abiName: "relay",
          publicName: "relay",
          type: spec.interfaces[0]!.methods[15]!.args[0]!.ty,
        },
        {
          abiName: "allowed",
          publicName: "allowed",
          type: spec.interfaces[0]!.methods[15]!.args[1]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[15]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    setRelayOnly: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.SetRelayOnlyArgs,
      KalienScore.v0_1.SetRelayOnlyResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "set_relay_only",
      publicName: "setRelayOnly",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.setRelayOnly,
      effect: spec.interfaces[0]!.methods[16]!.effect,
      args: [
        {
          abiName: "relay_only",
          publicName: "relayOnly",
          type: spec.interfaces[0]!.methods[16]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[16]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    setSeed: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.SetSeedArgs,
      KalienScore.v0_1.SetSeedResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "set_seed",
      publicName: "setSeed",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.setSeed,
      effect: spec.interfaces[0]!.methods[17]!.effect,
      args: [
        {
          abiName: "seed_id",
          publicName: "seedId",
          type: spec.interfaces[0]!.methods[17]!.args[0]!.ty,
        },
        {
          abiName: "seed",
          publicName: "seed",
          type: spec.interfaces[0]!.methods[17]!.args[1]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[17]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    submitScore: __gh_client_contract.defineContractMethod<
      KalienScore.v0_1.SubmitScoreArgs,
      KalienScore.v0_1.SubmitScoreResult,
      KalienScore.v0_1.DeclaredException
    >({
      interfaceName: "KalienScore",
      interfaceVersion: "0.1.0",
      abiName: "submit_score",
      publicName: "submitScore",
      entrypoint: __gh_entrypoints.KalienScore.v0_1.submitScore,
      effect: spec.interfaces[0]!.methods[18]!.effect,
      args: [
        {
          abiName: "player_pubkey",
          publicName: "playerPubkey",
          type: spec.interfaces[0]!.methods[18]!.args[0]!.ty,
        },
        {
          abiName: "seed_id",
          publicName: "seedId",
          type: spec.interfaces[0]!.methods[18]!.args[1]!.ty,
        },
        {
          abiName: "tape",
          publicName: "tape",
          type: spec.interfaces[0]!.methods[18]!.args[2]!.ty,
        },
        {
          abiName: "signature",
          publicName: "signature",
          type: spec.interfaces[0]!.methods[18]!.args[3]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[18]!.return_type,
      throws: [
        {
          selector: 0xdf1e219a979853c7n,
          name: "ScoreError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
  },
} as const;

export const kalien_score = {
  v0_1: {
    implementation: {
      AdminChanged: __gh_client_contract.defineContractEvent<
        "AdminChanged",
        kalien_score.v0_1.implementation.AdminChanged["topics"],
        kalien_score.v0_1.implementation.AdminChanged["fields"],
        kalien_score.v0_1.implementation.AdminChangedFilter
      >({
        name: "AdminChanged",
        signature: spec.events[0]!.signature,
        topics: [
          {
            name: "previous",
            type: spec.events[0]!.topics[0]!.ty,
            representation: "address",
          },
          {
            name: "admin",
            type: spec.events[0]!.topics[1]!.ty,
            representation: "address",
          },
        ],
        fields: [
        ],
        codecs: __gh_codecs,
      }),
      RelayChanged: __gh_client_contract.defineContractEvent<
        "RelayChanged",
        kalien_score.v0_1.implementation.RelayChanged["topics"],
        kalien_score.v0_1.implementation.RelayChanged["fields"],
        kalien_score.v0_1.implementation.RelayChangedFilter
      >({
        name: "RelayChanged",
        signature: spec.events[1]!.signature,
        topics: [
          {
            name: "relay",
            type: spec.events[1]!.topics[0]!.ty,
            representation: "address",
          },
        ],
        fields: [
          { name: "allowed", type: spec.events[1]!.fields[0]!.ty },
        ],
        codecs: __gh_codecs,
      }),
      ScoreError: {
        "AlreadyInitialized": 1n,
        "NotAdmin": 2n,
        "Paused": 3n,
        "UnknownSeed": 4n,
        "SeedInactive": 5n,
        "SeedMismatch": 6n,
        "BadSignature": 7n,
        "AlreadyClaimed": 8n,
        "ZeroScore": 9n,
        "NotImproved": 10n,
        "SeedAlreadySet": 11n,
        "ZeroSeed": 12n,
        "SeedingLocked": 13n,
        "NotRelay": 14n,
        "TapeTooShort": 20n,
        "TapeBadMagic": 21n,
        "TapeBadVersion": 22n,
        "TapeBadRulesTag": 23n,
        "TapeReservedNonZero": 24n,
        "TapeFrameCountOutOfRange": 25n,
        "TapeLengthMismatch": 26n,
        "TapeCrcMismatch": 27n,
        "TapeBadPadding": 28n,
        "RuleViolation": 30n,
        "FrameCountMismatch": 31n,
        "ScoreMismatch": 32n,
      },
      ScoreSubmitted: __gh_client_contract.defineContractEvent<
        "ScoreSubmitted",
        kalien_score.v0_1.implementation.ScoreSubmitted["topics"],
        kalien_score.v0_1.implementation.ScoreSubmitted["fields"],
        kalien_score.v0_1.implementation.ScoreSubmittedFilter
      >({
        name: "ScoreSubmitted",
        signature: spec.events[2]!.signature,
        topics: [
          {
            name: "player",
            type: spec.events[2]!.topics[0]!.ty,
            representation: "address",
          },
          {
            name: "seed_id",
            type: spec.events[2]!.topics[1]!.ty,
            representation: "u32",
          },
        ],
        fields: [
          { name: "player_pubkey", type: spec.events[2]!.fields[0]!.ty },
          { name: "seed", type: spec.events[2]!.fields[1]!.ty },
          { name: "frame_count", type: spec.events[2]!.fields[2]!.ty },
          { name: "final_score", type: spec.events[2]!.fields[3]!.ty },
          { name: "previous_best", type: spec.events[2]!.fields[4]!.ty },
          { name: "new_best", type: spec.events[2]!.fields[5]!.ty },
          { name: "minted_delta", type: spec.events[2]!.fields[6]!.ty },
          { name: "tape_hash", type: spec.events[2]!.fields[7]!.ty },
        ],
        codecs: __gh_codecs,
      }),
      SeedCreated: __gh_client_contract.defineContractEvent<
        "SeedCreated",
        kalien_score.v0_1.implementation.SeedCreated["topics"],
        kalien_score.v0_1.implementation.SeedCreated["fields"],
        kalien_score.v0_1.implementation.SeedCreatedFilter
      >({
        name: "SeedCreated",
        signature: spec.events[3]!.signature,
        topics: [
          {
            name: "seed_id",
            type: spec.events[3]!.topics[0]!.ty,
            representation: "u32",
          },
        ],
        fields: [
          { name: "seed", type: spec.events[3]!.fields[0]!.ty },
        ],
        codecs: __gh_codecs,
      }),
      SettingsChanged: __gh_client_contract.defineContractEvent<
        "SettingsChanged",
        kalien_score.v0_1.implementation.SettingsChanged["topics"],
        kalien_score.v0_1.implementation.SettingsChanged["fields"],
        kalien_score.v0_1.implementation.SettingsChangedFilter
      >({
        name: "SettingsChanged",
        signature: spec.events[4]!.signature,
        topics: [
        ],
        fields: [
          { name: "paused", type: spec.events[4]!.fields[0]!.ty },
          { name: "relay_only", type: spec.events[4]!.fields[1]!.ty },
          { name: "seeding_locked", type: spec.events[4]!.fields[2]!.ty },
        ],
        codecs: __gh_codecs,
      }),
    },
  },
} as const;

export type KalienScoreEvent = kalien_score.v0_1.implementation.AdminChanged | kalien_score.v0_1.implementation.RelayChanged | kalien_score.v0_1.implementation.ScoreSubmitted | kalien_score.v0_1.implementation.SeedCreated | kalien_score.v0_1.implementation.SettingsChanged;

export function decodeEvent(__gh_event: { topics: globalThis.Uint8Array[]; data: globalThis.Uint8Array }): KalienScoreEvent | null {
  return kalien_score.v0_1.implementation.AdminChanged.decode(__gh_event) ?? kalien_score.v0_1.implementation.RelayChanged.decode(__gh_event) ?? kalien_score.v0_1.implementation.ScoreSubmitted.decode(__gh_event) ?? kalien_score.v0_1.implementation.SeedCreated.decode(__gh_event) ?? kalien_score.v0_1.implementation.SettingsChanged.decode(__gh_event);
}

// The types the namespaces above refer to, under names no declaration can capture.
export namespace __gh_codegen {
  export type kalien_score$v0_1$implementation$Config = kalien_score.v0_1.implementation.Config;
  export type kalien_score$v0_1$implementation$ScoreError = kalien_score.v0_1.implementation.ScoreError;
  export type kalien_score$v0_1$implementation$ScoreReceipt = kalien_score.v0_1.implementation.ScoreReceipt;
  export type kalien_score$v0_1$implementation$SeedInfo = kalien_score.v0_1.implementation.SeedInfo;
}
