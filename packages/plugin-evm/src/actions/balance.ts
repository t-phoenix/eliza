import type {
    Action,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    State,
} from "@elizaos/core";
import {
    composeContext,
    generateObjectDeprecated,
    ModelClass,
    elizaLogger,
} from "@elizaos/core";
import { initWalletProvider, type WalletProvider } from "../providers/wallet";
import { balanceTemplate } from "../templates";
import type { BalanceParams, BalanceResponse, SupportedChain } from "../types";
import { Address, formatEther, formatUnits, parseAbi } from "viem";
import { createConfig, ExtendedChain, getToken } from "@lifi/sdk";

export class BalanceAction {

    constructor(private walletProvider: WalletProvider) {
        this.walletProvider = walletProvider;
    }

    async getBalance(params: BalanceParams): Promise<BalanceResponse> {
        console.log(
            `Getting Balance: ${params.token} balance of (${params.address} on ${params.chain})`
        );
        await this.validateAndNormalizeParams(params);
        const { chain, address, token } = params;
        if (!address) {
            throw new Error("Address is required for getting balance");
        }

        this.walletProvider.switchChain(chain);
        const nativeSymbol = this.walletProvider.getChainConfigs(chain).nativeCurrency.symbol
        // const publicClient = this.walletProvider.getPublicClient(params.chain);
        const chainId = this.walletProvider.getChainConfigs(chain).id;

        let queryNativeToken = false;
        if (
            !token ||
            token === "" ||
            token.toLowerCase() === "eth"
        ) {
            queryNativeToken = true;
        }


        let balance: string;

        try {
            if(!queryNativeToken){
                // If ERC20 token is requested
                console.log("Token requested is ERC20:", token)
                if(token.startsWith("0x")){
                    balance = await this.getERC20TokenBalance(
                        chain,
                        address,
                        token as `0x${string}`
                    );
                } else {
                    //Need lifi config for chain and token info
                    console.log(token, " token is ERC20, but not with address, so pair token with address on Chain", chain );
                    // this.walletProvider.configureLiFiSdk(chain);
                    // const tokenInfo = await getToken(chainId, token);
                    // console.log("Token Info: ", tokenInfo);

                    // balance=await this.getERC20TokenBalance(
                    //     chain,
                    //     address,
                    //     tokenInfo.address as `0x${string}`
                    // )
                    // NOT WORKING THIS FUNCTION GET WALLET ETH BALANCE
                    balance = await this.walletProvider.getWalletBalance();
                    console.log("Balance: ", balance);
                }
            }else{
                // If Native token is requested
                console.log("Native token is requested", nativeSymbol)
                const nativeBalanceWei =  await this.walletProvider.getPublicClient(chain).getBalance({address});
                balance = formatEther(nativeBalanceWei)
            }


            return {
                balance: balance.toString(),
                token: params.token,
                chain: params.chain,
                address: params.address,
            };
        } catch (error) {
            throw new Error(`Fetch Balance Failed: ${error.message}`)
        }
    }

    async getERC20TokenBalance(
        chain: SupportedChain,
        address: Address,
        tokenAddress: Address
    ): Promise<string> {
        const publicClient = this.walletProvider.getPublicClient(chain);

        const erc20Abi = parseAbi([
                    "function balanceOf(address) view returns (uint256)",
                    "function decimals() view returns (uint8)"
                ]);
        const balance = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
        });

        const decimals = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "decimals",
        });

        return formatUnits(balance, decimals);
    }

    async validateAndNormalizeParams(params: BalanceParams): Promise<void> {
        if (!params.address) {
            params.address = this.walletProvider.getAddress();
        }
    }
}

export const balanceAction: Action = {
    name: "balance",
    description: "Fetch token balances for a wallet address",
    handler: async (
        runtime: IAgentRuntime,
        _message: Memory,
        state: State,
        _options: any,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Balance action handler called `evm plugin`");
        
        
        const walletProvider = await initWalletProvider(runtime);
        const action = new BalanceAction(walletProvider);

        // Compose balance context
        const balanceContext = composeContext({
            state,
            template: balanceTemplate,
        });
        const content = (await generateObjectDeprecated({
            runtime,
            context: balanceContext,
            modelClass: ModelClass.LARGE,
        })) as BalanceParams;

        const balanceParams: BalanceParams = {
            chain: content.chain,
            token: content.token,
            address: content.address,
        };

        try {
            const balanceResp = await action.getBalance(balanceParams);
            if (callback) {
                callback({
                    text: `Balance for ${balanceParams.token} on ${balanceParams.chain}: ${balanceResp.balance}`,
                    content: {
                        success: true,
                        balance: balanceResp.balance,
                        token: balanceResp.token,
                        chain: balanceResp.chain,
                        address: balanceResp.address,
                    },
                });
            }
            return true;
        } catch (error) {
            elizaLogger.error("Error in balance handler:", error.message);
            if (callback) {
                callback({ text: `Error: ${error.message}` });
            }
            return false;
        }
    },
    validate: async (runtime: IAgentRuntime) => {
        const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
        return typeof privateKey === "string" && privateKey.startsWith("0x");
    },
    examples: [
        [
            {
                user: "assistant",
                content: {
                    text: "I'll help you get your balance on Mainnet",
                    action: "CHECK_BALANCE",
                },
            },
            {
                user: "user",
                content: {
                    text: "What's my ETH balance on Mainnet?",
                    action: "CHECK_BALANCE",
                },
            },
        ],
        [
            {
                user: "assistant",
                content: {
                    text: "I'll help you get the USDC balance of 0x742d35Cc6634C0532925a3b844Bc454e4438f44e on Sepolia ",
                    action: "GET_BALANCE",
                },
            },
            {
                user: "user",
                content: {
                    text: "What's my USDC balance of 0x742d35Cc6634C0532925a3b844Bc454e4438f44e on Sepolia?",
                    action: "GET_BALANCE",
                },
            },
        ],
        [
            {
                user: "assistant",
                content: {
                    text: "I'll help you get the WBTC  balance of 0x742d35Cc6634C0532925a3b844Bc454e4438f44e on Base ",
                    action: "FETCH_BALANCE",
                },
            },
            {
                user: "user",
                content: {
                    text: "What's my WBTC balance of 0x742d35Cc6634C0532925a3b844Bc454e4438f44e on Base?",
                    action: "FETCH_BALANCE",
                },
            },
        ],
    ],
    similes: ["CHECK_BALANCE", "FETCH_BALANCE", "GET_BALANCE"],
};
