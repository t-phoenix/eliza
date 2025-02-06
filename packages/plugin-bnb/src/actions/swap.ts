import {
    composeContext,
    elizaLogger,
    generateObjectDeprecated,
    type HandlerCallback,
    ModelClass,
    type IAgentRuntime,
    type Memory,
    type State,
} from "@elizaos/core";
import { executeRoute, getRoutes } from "@lifi/sdk";
import { erc20Abi, parseEther } from "viem";

import {
    bnbWalletProvider,
    initWalletProvider,
    type WalletProvider,
} from "../providers/wallet";
import { swapTemplate } from "../templates";
import type { SwapParams, SwapResponse } from "../types";

export { swapTemplate };

export class SwapAction {
    constructor(private walletProvider: WalletProvider) {}

    async swap(params: SwapParams): Promise<SwapResponse> {
        elizaLogger.debug("Swap params:", params);
        // this.validateAndNormalizeParams(params);
        elizaLogger.debug("Normalized swap params:", params);

        console.log("Swap: ", params.chain, " From Token: ", params.fromToken, " To Token: ", params.toToken, " Amount: ", params.amount)

        const fromAddress = this.walletProvider.getAddress();

        await this.walletProvider.switchChain(params.chain);
        const chainId = this.walletProvider.getChainConfigs(params.chain).id;
        const nativeToken = this.walletProvider.chains[params.chain].nativeCurrency.symbol;
        console.log("Chain Id: ", chainId, " Native Token: ", nativeToken);

        //Get token Address and Handle Native Token
        const fromTokenAddressInput = params.fromToken === nativeToken 
            ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" 
            : await this.walletProvider.getTokenAddress(params.chain, params.fromToken);
        const toTokenAddressInput = params.toToken === nativeToken 
            ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" 
            : await this.walletProvider.getTokenAddress(params.chain, params.toToken);
        console.log("From Token Address: ", params.fromToken, " : ", fromTokenAddressInput, " To Token Address: ", params.toToken, " : ", toTokenAddressInput);

         // Calculate amount based on token decimals
        let fromAmountInput: string;
        if (params.fromToken ===  nativeToken) {
            fromAmountInput = parseEther(params.amount).toString();
        } else {

            const publicClient = this.walletProvider.getPublicClient(
                params.chain
            );
            const decimals = await publicClient.readContract({
                address: fromTokenAddressInput as `0x${string}`,
                abi: erc20Abi,
                functionName: "decimals",
            });            
            fromAmountInput = (BigInt(Math.floor(parseFloat(params.amount) * Math.pow(10, decimals)))).toString();
        }

        console.log("From Amount Input: ", fromAmountInput, ": ", params.fromToken);

        this.walletProvider.configureLiFiSdk(params.chain);

        const resp: SwapResponse = {
            chain: params.chain,
            txHash: "0x",
            fromToken: params.fromToken,
            toToken: params.toToken,
            amount: params.amount,
        };

        console.log("Slippage: ", params.slippage);

        const routes = await getRoutes({
            fromChainId: chainId,
            toChainId: chainId,
            fromTokenAddress: fromTokenAddressInput as `0x${string}`, // Setup Address
            toTokenAddress: toTokenAddressInput as `0x${string}`, // Setup Address
            fromAmount: fromAmountInput, // Setup for ERC and Native
            fromAddress: fromAddress as `0x${string}`,
            // options: {
            //     slippage: params.slippage === null ? 0.005 : params.slippage,
            //     order: "RECOMMENDED",
            // },
        });

        if (!routes.routes.length) throw new Error("No routes found");

        const execution = await executeRoute(routes.routes[0]);
        const process =
            execution.steps[0]?.execution?.process[
                execution.steps[0]?.execution?.process.length - 1
            ];

        if (!process?.status || process.status === "FAILED") {
            throw new Error("Transaction failed");
        }

        resp.txHash = process.txHash as `0x${string}`;

        return resp;
    }

    validateAndNormalizeParams(params: SwapParams): void {
        if (params.chain !== "bsc") {
            throw new Error("Only BSC mainnet is supported");
        }
    }
}

export const swapAction = {
    name: "swap",
    description: "Swap tokens on the same chain",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting swap action...");

        // Initialize or update state
        let currentState = state;
        if (!currentState) {
            currentState = (await runtime.composeState(message)) as State;
        } else {
            currentState = await runtime.updateRecentMessageState(currentState);
        }

        state.walletInfo = await bnbWalletProvider.get(
            runtime,
            message,
            currentState
        );

        // Compose swap context
        const swapContext = composeContext({
            state: currentState,
            template: swapTemplate,
        });
        const content = await generateObjectDeprecated({
            runtime,
            context: swapContext,
            modelClass: ModelClass.LARGE,
        });

        const walletProvider = initWalletProvider(runtime);
        const action = new SwapAction(walletProvider);
        const swapOptions: SwapParams = {
            chain: content.chain,
            fromToken: content.inputToken,
            toToken: content.outputToken,
            amount: content.amount,
            slippage: content.slippage,
        };
        try {
            const swapResp = await action.swap(swapOptions);
            callback?.({
                text: `Successfully swap ${swapResp.amount} ${swapResp.fromToken} tokens to ${swapResp.toToken}\nTransaction Hash: ${swapResp.txHash}`,
                content: { ...swapResp },
            });
            return true;
        } catch (error) {
            elizaLogger.error("Error during swap:", error.message);
            callback?.({
                text: `Swap failed: ${error.message}`,
                content: { error: error.message },
            });
            return false;
        }
    },
    template: swapTemplate,
    validate: async (runtime: IAgentRuntime) => {
        const privateKey = runtime.getSetting("BNB_PRIVATE_KEY");
        return typeof privateKey === "string" && privateKey.startsWith("0x");
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Swap 1 BNB for USDC on BSC",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll help you swap 1 BNB for USDC on BSC",
                    action: "SWAP",
                    content: {
                        chain: "bsc",
                        inputToken: "BNB",
                        outputToken: "USDC",
                        amount: "1",
                        slippage: undefined,
                    },
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Buy some token of 0x1234 using 1 USDC on BSC. The slippage should be no more than 5%",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll help you swap 1 USDC for token 0x1234 on BSC",
                    action: "SWAP",
                    content: {
                        chain: "bsc",
                        inputToken: "USDC",
                        outputToken: "0x1234",
                        amount: "1",
                        slippage: 0.05,
                    },
                },
            },
        ],
    ],
    similes: ["SWAP", "TOKEN_SWAP", "EXCHANGE_TOKENS", "TRADE_TOKENS"],
};
