// Copyright (c) 2026 The LAVE Core developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include <base58.h>
#include <chainparams.h>
#include <chainparamsbase.h>
#include <key_io.h>
#include <pow.h>
#include <spork.h>
#include <test/util/setup_common.h>
#include <util/message.h>
#include <util/system.h>

#include <algorithm>
#include <array>
#include <stdexcept>
#include <utility>

#include <boost/test/unit_test.hpp>

namespace {
struct LaveTestingSetup : BasicTestingSetup {
    LaveTestingSetup() : BasicTestingSetup(CBaseChainParams::DEVNET, {"-devnet=lave-local-v1", "-listen=0", "-listenonion=0"}) {}
};

std::string WithPrefix(const std::string& encoded, const std::vector<unsigned char>& prefix)
{
    std::vector<unsigned char> payload;
    if (!DecodeBase58Check(encoded, payload, 100)) throw std::runtime_error("Invalid test encoding");
    std::copy(prefix.begin(), prefix.end(), payload.begin());
    return EncodeBase58Check(payload);
}
} // namespace

BOOST_FIXTURE_TEST_SUITE(lave_params_tests, LaveTestingSetup)

BOOST_AUTO_TEST_CASE(pinned_chain_identity)
{
    const auto& params = Params();
    const auto& consensus = params.GetConsensus();
    BOOST_CHECK_EQUAL(consensus.hashGenesisBlock.GetHex(), "28fae923c5ef15cb623f14f61aae383050712a8ef7ff740bb2b1541d8a3bcf9c");
    BOOST_CHECK_EQUAL(consensus.hashDevnetGenesisBlock.GetHex(), "2043af4ec0030900338e8ad5eb86428008787d4be468f197d2bcd1776c094209");
    BOOST_CHECK_EQUAL(params.GenesisBlock().GetHash(), consensus.hashGenesisBlock);
    BOOST_CHECK_EQUAL(params.DevNetGenesisBlock().hashPrevBlock, consensus.hashGenesisBlock);
    BOOST_CHECK(CheckProofOfWork(params.GenesisBlock().GetHash(), params.GenesisBlock().nBits, consensus));
    BOOST_CHECK(CheckProofOfWork(params.DevNetGenesisBlock().GetHash(), params.DevNetGenesisBlock().nBits, consensus));
    BOOST_CHECK(params.GenesisBlock().vtx[0]->vout[0].scriptPubKey.IsUnspendable());
    const CMessageHeader::MessageStartChars magic{0xfa, 0x4c, 0x56, 0xb9};
    BOOST_CHECK_EQUAL_COLLECTIONS(params.MessageStart(), params.MessageStart() + 4, magic, magic + 4);
    BOOST_CHECK_EQUAL(params.GetDefaultPort(), 19779);
    BOOST_CHECK_EQUAL(BaseParams().RPCPort(), 19778);
    BOOST_CHECK_EQUAL(BaseParams().DataDir(), "devnet-lave-local-v1");
    BOOST_CHECK(params.SporkAddresses().empty());
    BOOST_CHECK(params.DNSSeeds().empty());
    BOOST_CHECK(params.FixedSeeds().empty());
    BOOST_CHECK_EQUAL(consensus.nMinimumDifficultyBlocks, 10000);
    BOOST_CHECK_EQUAL(consensus.nHighSubsidyBlocks, 1);
    BOOST_CHECK_EQUAL(consensus.nHighSubsidyFactor, 1);
    BOOST_CHECK_EQUAL(MESSAGE_MAGIC, "LAVE Signed Message:\n");
    BOOST_CHECK(!params.IsLaveQuorumLab());
    CSporkManager sporks;
    BOOST_CHECK_EQUAL(sporks.GetSporkValue(SPORK_17_QUORUM_DKG_ENABLED), 4070908800ULL);
    BOOST_CHECK_EQUAL(sporks.GetSporkValue(SPORK_2_INSTANTSEND_ENABLED), 4070908800ULL);
    BOOST_CHECK_EQUAL(sporks.GetSporkValue(SPORK_19_CHAINLOCKS_ENABLED), 4070908800ULL);
}

BOOST_AUTO_TEST_CASE(address_and_key_domains)
{
    CKey key;
    key.MakeNewKey(true);
    const std::string address = EncodeDestination(PKHash(key.GetPubKey()));
    BOOST_CHECK_EQUAL(address.front(), 'L');
    BOOST_CHECK(IsValidDestinationString(address));
    for (const unsigned char prefix : {76, 140}) {
        BOOST_CHECK(!IsValidDestinationString(WithPrefix(address, {prefix})));
    }
    const std::string script_address = EncodeDestination(ScriptHash(CScript() << OP_TRUE));
    BOOST_CHECK(IsValidDestinationString(script_address));
    for (const unsigned char prefix : {16, 19}) {
        BOOST_CHECK(!IsValidDestinationString(WithPrefix(script_address, {prefix})));
    }
    const std::string secret = EncodeSecret(key);
    BOOST_CHECK(DecodeSecret(secret).IsValid());
    for (const unsigned char prefix : {204, 239}) {
        BOOST_CHECK(!DecodeSecret(WithPrefix(secret, {prefix})).IsValid());
    }

    CExtKey extended;
    const std::array<unsigned char, 32> seed{42};
    extended.SetSeed(MakeByteSpan(seed));
    const std::string xprv = EncodeExtKey(extended);
    const std::string xpub = EncodeExtPubKey(extended.Neuter());
    BOOST_CHECK(DecodeExtKey(xprv).key.IsValid());
    BOOST_CHECK(DecodeExtPubKey(xpub).pubkey.IsValid());
    BOOST_CHECK(!DecodeExtKey(WithPrefix(xprv, {0x04, 0x88, 0xad, 0xe4})).key.IsValid());
    BOOST_CHECK(!DecodeExtKey(WithPrefix(xprv, {0x04, 0x35, 0x83, 0x94})).key.IsValid());
    BOOST_CHECK(!DecodeExtPubKey(WithPrefix(xpub, {0x04, 0x88, 0xb2, 0x1e})).pubkey.IsValid());
    BOOST_CHECK(!DecodeExtPubKey(WithPrefix(xpub, {0x04, 0x35, 0x87, 0xcf})).pubkey.IsValid());
}

BOOST_AUTO_TEST_CASE(reject_other_networks_and_authorities)
{
    ArgsManager args;
    SetupChainParamsOptions(args);
    BOOST_CHECK_THROW(RequireLaveLocalChain(args), std::runtime_error);
    for (const auto& [option, value] : {std::pair{"-chain", "main"}, std::pair{"-chain", "devnet"},
                                      std::pair{"-testnet", "1"}, std::pair{"-regtest", "1"},
                                      std::pair{"-devnet", "atlas-local-v1"}, std::pair{"-devnet", ""}}) {
        ArgsManager invalid;
        SetupChainParamsOptions(invalid);
        invalid.ForceSetArg(option, value);
        BOOST_CHECK_THROW(RequireLaveLocalChain(invalid), std::runtime_error);
    }
    args.ForceSetArg("-devnet", "lave-local-v1");
    BOOST_CHECK_NO_THROW(RequireLaveLocalChain(args));
    for (const auto& [option, value] : {std::pair{"-minimumdifficultyblocks", "9999"}, std::pair{"-highsubsidyblocks", "0"},
                                      std::pair{"-highsubsidyfactor", "2"}, std::pair{"-sporkaddr", "test"},
                                      std::pair{"-sporkkey", "test"}, std::pair{"-minsporkkeys", "1"},
                                      std::pair{"-llmqchainlocks", "llmq_devnet"}, std::pair{"-powtargetspacing", "1"}}) {
        ArgsManager invalid;
        SetupChainParamsOptions(invalid);
        invalid.ForceSetArg("-devnet", "lave-local-v1");
        invalid.ForceSetArg(option, value);
        BOOST_CHECK_THROW(RequireLaveLocalChain(invalid), std::runtime_error);
    }
    args.ForceSetArg("-minimumdifficultyblocks", "10000");
    args.ForceSetArg("-highsubsidyblocks", "1");
    args.ForceSetArg("-highsubsidyfactor", "1");
    BOOST_CHECK_NO_THROW(RequireLaveLocalChain(args));
}

namespace {
struct LaveQuorumTestingSetup : BasicTestingSetup {
    LaveQuorumTestingSetup() : BasicTestingSetup(CBaseChainParams::DEVNET, {"-devnet=lave-quorum-v1", "-listen=0", "-listenonion=0"}) {}
};
} // namespace

BOOST_FIXTURE_TEST_CASE(isolated_quorum_identity_and_activation, LaveQuorumTestingSetup)
{
    const auto& params = Params();
    BOOST_CHECK(params.IsLaveQuorumLab());
    BOOST_CHECK(params.IsMockableChain());
    BOOST_CHECK(!params.RequireRoutableExternalIP());
    BOOST_CHECK_EQUAL(params.GetConsensus().hashGenesisBlock.GetHex(), "3db65802980f975c71d3c4e095a0d45304b4e419a09fd2182aee54cb3eaed4de");
    BOOST_CHECK_EQUAL(params.GetConsensus().hashDevnetGenesisBlock.GetHex(), "4d77c6b3447becea615bebe369a6771937d6d2722baf99060f9704f7b112a4e1");
    BOOST_CHECK(CheckProofOfWork(params.GenesisBlock().GetHash(), params.GenesisBlock().nBits, params.GetConsensus()));
    BOOST_CHECK(CheckProofOfWork(params.DevNetGenesisBlock().GetHash(), params.DevNetGenesisBlock().nBits, params.GetConsensus()));
    BOOST_CHECK_EQUAL(BaseParams().DataDir(), "devnet-lave-quorum-v1");
    BOOST_CHECK_EQUAL(BaseParams().RPCPort(), 19788);
    BOOST_CHECK_EQUAL(params.GetDefaultPort(), 19789);
    const CMessageHeader::MessageStartChars magic{0xfa, 0x4c, 0x51, 0xb9};
    BOOST_CHECK_EQUAL_COLLECTIONS(params.MessageStart(), params.MessageStart() + 4, magic, magic + 4);
    CSporkManager sporks;
    for (const auto id : {SPORK_2_INSTANTSEND_ENABLED, SPORK_3_INSTANTSEND_BLOCK_FILTERING,
                          SPORK_17_QUORUM_DKG_ENABLED, SPORK_19_CHAINLOCKS_ENABLED,
                          SPORK_21_QUORUM_ALL_CONNECTED, SPORK_23_QUORUM_POSE}) {
        BOOST_CHECK_EQUAL(sporks.GetSporkValue(id), 0);
    }
    BOOST_CHECK_EQUAL(sporks.GetSporkValue(SPORK_9_SUPERBLOCKS_ENABLED), 4070908800ULL);
    BOOST_CHECK(params.SporkAddresses().empty());
    const auto cl = params.GetLLMQ(params.GetConsensus().llmqTypeChainLocks);
    const auto is = params.GetLLMQ(params.GetConsensus().llmqTypeDIP0024InstantSend);
    BOOST_REQUIRE(cl.has_value());
    BOOST_REQUIRE(is.has_value());
    BOOST_CHECK_EQUAL(cl->size, 3);
    BOOST_CHECK_EQUAL(cl->threshold, 2);
    BOOST_CHECK_EQUAL(is->size, 4);
    BOOST_CHECK_EQUAL(is->threshold, 3);
    BOOST_CHECK(is->useRotation);
    BOOST_CHECK_EQUAL(is->signingActiveQuorumCount, 2);
    CKey key;
    key.MakeNewKey(true);
    const auto address = EncodeDestination(PKHash(key.GetPubKey()));
    BOOST_CHECK(IsValidDestinationString(address));
    BOOST_CHECK(!IsValidDestinationString(WithPrefix(address, {48})));
    BOOST_CHECK(!DecodeSecret(WithPrefix(EncodeSecret(key), {181})).IsValid());
    BOOST_CHECK_NO_THROW(RequireLaveLocalChain(gArgs));
}

BOOST_AUTO_TEST_SUITE_END()
