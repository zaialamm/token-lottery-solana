import * as anchor from '@coral-xyz/anchor';
import * as sb from "@switchboard-xyz/on-demand";
import { Program } from '@coral-xyz/anchor';
import { TokenLottery } from '../target/types/token_lottery';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import SwitchboardIDL from '../switchboard.json';

describe('token_lottery', () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;
  anchor.setProvider(provider);

  const program = anchor.workspace.TokenLottery as Program<TokenLottery>;

  const switchboardProgram = new anchor.Program(SwitchboardIDL as anchor.Idl, provider);
  const rngKp = anchor.web3.Keypair.generate();

  async function buyTicket() {
    const buyTicketIx = await program.methods.buyTicket()
      .accounts({
        tokenProgram: TOKEN_PROGRAM_ID,

      })
      .instruction();

    
    const computeIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit(
      {
        units: 300000
      }
    );

    const priorityIx = anchor.web3.ComputeBudgetProgram.setComputeUnitPrice(
      {
        microLamports: 1
      }

    )

    const blockhashContext = await connection.getLatestBlockhash();

    const buyTicketTx = new anchor.web3.Transaction(
      {
        feePayer: wallet.payer.publicKey,
        blockhash: blockhashContext.blockhash,
        lastValidBlockHeight: blockhashContext.lastValidBlockHeight
      }
    )
      .add(buyTicketIx)
      .add(computeIx)
      .add(priorityIx);

    const BuyTicketsignature = await anchor.web3
      .sendAndConfirmTransaction(
        connection, 
        buyTicketTx, 
        [wallet.payer],
        {skipPreflight: true}
    );

    console.log("Buy ticket signature:", BuyTicketsignature);

  }

  // test for init_config and init_lottery 
  it('should initialize config and lottery', async () => {

    const slot = await connection.getSlot();

    const initConfigIx = await program.methods.initializeConfig(
      new anchor.BN(0),
      new anchor.BN(slot + 11),
      new anchor.BN(10000)
    ).instruction();

    const blockhashContext = await connection.getLatestBlockhash();

    const tx = new anchor.web3.Transaction(
      {
        feePayer: wallet.payer.publicKey,
        blockhash: blockhashContext.blockhash,
        lastValidBlockHeight: blockhashContext.lastValidBlockHeight
      }
    )
      .add(initConfigIx);

    const signature = await anchor.web3
      .sendAndConfirmTransaction(
        provider.connection, 
        tx, 
        [wallet.payer]
    );

    console.log("Transaction initConfig signature:", signature);


    const initLotteryIx = await program.methods.initializeLottery().accounts({
      tokenProgram: TOKEN_PROGRAM_ID
    }).instruction();

    const initLotteryTx = new anchor.web3.Transaction(
      {
        feePayer: wallet.payer.publicKey,
        blockhash: blockhashContext.blockhash,
        lastValidBlockHeight: blockhashContext.lastValidBlockHeight
      }
    )
      .add(initLotteryIx);

    const initLotterySignature = await anchor.web3
      .sendAndConfirmTransaction(
        connection, 
        initLotteryTx, 
        [wallet.payer]
    );

    console.log("Transaction initLottery signature:", initLotterySignature);

  });

  // test buy ticket
  it("should buying tickets", async() => {
      await buyTicket();
      await buyTicket();
      await buyTicket();
      await buyTicket();
      await buyTicket();
      await buyTicket();
      await buyTicket();
  });

  // test create randomness account
  it("should create a randomness account, commit randomness, and reveal winner", async () => {

    const slot = await provider.connection.getSlot();
    const endSlot = slot + 20;

    const queue = new anchor.web3.PublicKey("A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w");
    
    const queueAccount = new sb.Queue(switchboardProgram, queue);

    try {
      await queueAccount.loadData();
    } catch (err) {
      console.log("Queue account not found");
      process.exit(1);
    }

    const [randomness, Ix] = await sb.Randomness.create(switchboardProgram, rngKp, queue);
    console.log("Created randomness account..");
    console.log("Randomness account", randomness.pubkey.toBase58());
    console.log("rkp account", rngKp.publicKey.toBase58());

    const createRandomnessTx = await sb.asV0Tx({
      connection: connection,
      ixs: [Ix],
      payer: wallet.publicKey,
      signers: [wallet.payer, rngKp],
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    });

    const blockhashContext = await connection.getLatestBlockhashAndContext();

    const createRandomnessSig = await connection.sendTransaction(createRandomnessTx);
    await connection.confirmTransaction({
      signature: createRandomnessSig,
      blockhash: blockhashContext.value.blockhash,
      lastValidBlockHeight: blockhashContext.value.lastValidBlockHeight
    });

    console.log('Create randomness account signature:', createRandomnessSig);

    const sbCommitIx = await randomness.commitIx(queue);

    const commitIx = await program.methods.commitRandomness().accounts( 
      {
      randomnessAccountData: randomness.pubkey
      }
    ).instruction();

    const commitTx = await sb.asV0Tx({
      connection: switchboardProgram.provider.connection,
      ixs: [sbCommitIx, commitIx],
      payer: wallet.publicKey,
      signers: [wallet.payer],
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3
    });

    const commitSignature = await connection.sendTransaction(commitTx);
    await connection.confirmTransaction({
      signature: commitSignature,
      blockhash: blockhashContext.value.blockhash,
      lastValidBlockHeight: blockhashContext.value.lastValidBlockHeight
    })

    console.log("Commit Transaction Signature:", commitSignature);

    const sbRevealIx = await randomness.revealIx();
    const revealWinnerIx = await program.methods.chooseWinner()
      .accounts({
        randomnessAccountData: randomness.pubkey
      })
      .instruction();
    

    const revealTx = await sb.asV0Tx({
      connection: switchboardProgram.provider.connection,
      ixs: [sbRevealIx, revealWinnerIx],
      payer: wallet.publicKey,
      signers: [wallet.payer],
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    });

    
    const revealSignature = await connection.sendTransaction(revealTx);
    await connection.confirmTransaction({
      signature: revealSignature,
      blockhash: blockhashContext.value.blockhash,
      lastValidBlockHeight: blockhashContext.value.lastValidBlockHeight
    });

    console.log("Transaction Signature revealTx", revealSignature);

  }, 250000); 

  it("should claim a prize", async () => {
    const claimIx = await program.methods.claimPrize()
      .accounts({
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const blockhashContext = await connection.getLatestBlockhash();

    const claimTx = new anchor.web3.Transaction({
      blockhash: blockhashContext.blockhash,
      lastValidBlockHeight: blockhashContext.lastValidBlockHeight,
      feePayer: wallet.payer.publicKey,
    }).add(claimIx);

    const claimSignature = await anchor.web3.sendAndConfirmTransaction(connection, claimTx, [wallet.payer]);
    console.log("Claim prize signature:", claimSignature);

  });

});
