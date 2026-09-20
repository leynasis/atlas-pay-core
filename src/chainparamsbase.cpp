// Copyright (c) 2010 Satoshi Nakamoto
// Copyright (c) 2009-2021 The Bitcoin Core developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include <chainparamsbase.h>

#include <tinyformat.h>
#include <util/system.h>

#include <assert.h>
#include <stdexcept>
#include <utility>

const std::string CBaseChainParams::MAIN = "main";
const std::string CBaseChainParams::TESTNET = "test";
const std::string CBaseChainParams::DEVNET = "devnet";
const std::string CBaseChainParams::REGTEST = "regtest";

void SetupChainParamsBaseOptions(ArgsManager& argsman)
{
    argsman.AddArg("-chain=<chain>", "Unsupported in this development build; use -devnet=lave-local-v1", ArgsManager::ALLOW_ANY, OptionsCategory::CHAINPARAMS);
    argsman.AddArg("-devnet=<name>", "Use the LAVE local test chain; the only supported name is lave-local-v1", ArgsManager::ALLOW_ANY, OptionsCategory::CHAINPARAMS);
    argsman.AddArg("-regtest", "Enter regression test mode, which uses a special chain in which blocks can be solved instantly. "
                   "This is intended for regression testing tools and app development. Equivalent to -chain=regtest", ArgsManager::ALLOW_ANY | ArgsManager::DEBUG_ONLY, OptionsCategory::CHAINPARAMS);
    argsman.AddArg("-testnet", "Use the test chain. Equivalent to -chain=test", ArgsManager::ALLOW_ANY, OptionsCategory::CHAINPARAMS);
}

static std::unique_ptr<CBaseChainParams> globalChainBaseParams;

const CBaseChainParams& BaseParams()
{
    assert(globalChainBaseParams);
    return *globalChainBaseParams;
}

/**
 * Port numbers for incoming Tor connections (9996, 19996, 19796, 19896) have
 * been chosen arbitrarily to keep ranges of used ports tight.
 */
std::unique_ptr<CBaseChainParams> CreateBaseChainParams(const std::string& chain)
{
    if (chain == CBaseChainParams::MAIN)
        return std::make_unique<CBaseChainParams>("", 9998, 9996);
    else if (chain == CBaseChainParams::TESTNET)
        return std::make_unique<CBaseChainParams>("testnet3", 19998, 19996);
    else if (chain == CBaseChainParams::DEVNET)
        return std::make_unique<CBaseChainParams>(gArgs.GetDevNetName(), 19778, 19776);
    else if (chain == CBaseChainParams::REGTEST)
        return std::make_unique<CBaseChainParams>("regtest", 19898, 19896);
    else
        throw std::runtime_error(strprintf("%s: Unknown chain %s.", __func__, chain));
}

void SelectBaseParams(const std::string& chain)
{
    globalChainBaseParams = CreateBaseChainParams(chain);
    gArgs.SelectConfigNetwork(chain);
}

void RequireLaveLocalChain(const ArgsManager& args)
{
    if (args.GetChainName() != CBaseChainParams::DEVNET || args.GetArg("-devnet", "") != "lave-local-v1") {
        throw std::runtime_error("LAVE Core is a local development build. Explicit -devnet=lave-local-v1 is required; Dash mainnet, testnet and regtest are disabled.");
    }
    for (const char* option : {"-sporkaddr", "-sporkkey", "-minsporkkeys", "-llmqchainlocks", "-llmqdevnetparams",
                               "-llmqinstantsenddip0024", "-llmqplatform", "-llmqmnhf", "-powtargetspacing"}) {
        if (args.IsArgSet(option)) {
            throw std::runtime_error(strprintf("LAVE local chain identity does not permit %s overrides.", option));
        }
    }
    for (const auto& [option, expected] : {std::pair{"-minimumdifficultyblocks", 10000},
                                         std::pair{"-highsubsidyblocks", 1}, std::pair{"-highsubsidyfactor", 1}}) {
        if (args.GetIntArg(option, expected) != expected) {
            throw std::runtime_error(strprintf("LAVE local chain requires %s=%d.", option, expected));
        }
    }
}
