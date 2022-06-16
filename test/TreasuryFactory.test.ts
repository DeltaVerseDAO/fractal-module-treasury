import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  AccessControlDAO,
  AccessControlDAO__factory,
  DAO,
  DAO__factory,
  VotesTokenWithSupply,
  VotesTokenWithSupply__factory,
  MockERC721,
  MockERC721__factory,
  IModuleFactory__factory,
  TreasuryModule,
  TreasuryModule__factory,
  TreasuryModuleFactory,
  TreasuryModuleFactory__factory,
  ERC1967Proxy__factory,
} from "../typechain-types";
import chai from "chai";
import { deployments, ethers } from "hardhat";
import { BigNumber } from "ethers";
import getInterfaceSelector from "./helpers/getInterfaceSelector";
import {
  createTreasuryFromFactory,
  TreasuryDepositEth,
  TreasuryWithdrawEth,
  TreasuryDepositERC20Tokens,
  TreasuryWithdrawERC20Tokens,
  TreasuryDepositERC721Tokens,
  TreasuryWithdrawERC721Tokens,
} from "./helpers/Index";

const expect = chai.expect;

describe("Treasury Factory", function () {
  let dao: DAO;
  let accessControl: AccessControlDAO;
  let treasuryFactory: TreasuryModuleFactory;
  let treasuryImplementationOne: TreasuryModule;
  let treasuryImplementationTwo: TreasuryModule;
  let treasury: TreasuryModule;

  // eslint-disable-next-line camelcase
  let erc20TokenAlpha: VotesTokenWithSupply;
  let erc20TokenBravo: VotesTokenWithSupply;
  let erc721TokenAlpha: MockERC721;
  let erc721TokenBravo: MockERC721;
  let deployer: SignerWithAddress;
  let withdrawer: SignerWithAddress;
  let userA: SignerWithAddress;
  let userB: SignerWithAddress;
  let upgrader: SignerWithAddress;

  // Roles
  const daoRoleString = "DAO_ROLE";
  const withdrawerRoleString = "WITHDRAWER_ROLE";
  const upgraderRoleString = "UPGRADER_ROLE";

  describe("ModuleFactoryBase", function () {
    beforeEach(async function () {
      [deployer, withdrawer, userA, userB, upgrader] =
        await ethers.getSigners();

      await deployments.fixture();
      dao = await new DAO__factory(deployer).deploy();
      accessControl = await new AccessControlDAO__factory(deployer).deploy();
      treasuryFactory = await ethers.getContract("TreasuryModuleFactory");
      treasuryImplementationOne = await new TreasuryModule__factory(
        deployer
      ).deploy();
      treasuryImplementationTwo = await new TreasuryModule__factory(
        deployer
      ).deploy();

      const treasuryAddress = await createTreasuryFromFactory(
        deployer,
        treasuryFactory,
        accessControl.address,
        treasuryImplementationOne.address,
        ethers.utils.formatBytes32String("hi")
      );

      await treasuryFactory.initialize();

      // eslint-disable-next-line camelcase
      treasury = TreasuryModule__factory.connect(treasuryAddress, deployer);

      await accessControl
        .connect(deployer)
        .initialize(
          dao.address,
          [withdrawerRoleString, upgraderRoleString],
          [daoRoleString, daoRoleString],
          [[withdrawer.address], [upgrader.address]],
          [
            treasury.address,
            treasury.address,
            treasury.address,
            treasury.address,
            treasury.address,
            treasury.address,
          ],
          [
            "withdrawEth(address[],uint256[])",
            "depositERC20Tokens(address[],address[],uint256[])",
            "withdrawERC20Tokens(address[],address[],uint256[])",
            "depositERC721Tokens(address[],address[],uint256[])",
            "withdrawERC721Tokens(address[],address[],uint256[])",
            "upgradeTo(address)",
          ],
          [
            [withdrawerRoleString],
            [withdrawerRoleString],
            [withdrawerRoleString],
            [withdrawerRoleString],
            [withdrawerRoleString],
            [upgraderRoleString],
          ]
        );

      await TreasuryDepositEth(
        treasury,
        deployer,
        ethers.utils.parseUnits("10", 18)
      );
    });

    it("New version can be added to the version Control", async () => {
      await expect(
        treasuryFactory.addVersion(
          "1.0.0",
          "hash/uir",
          treasuryImplementationOne.address
        )
      ).to.emit(treasuryFactory, "VersionCreated");
    });

    it("New version cannot be added by an unauthorized user", async () => {
      await expect(
        treasuryFactory
          .connect(withdrawer)
          .addVersion("1.0.1", "hash/uir", treasuryImplementationTwo.address)
      ).to.be.revertedWith("NotAuthorized()");
    });

    it("Returns current version", async () => {
      await expect(
        treasuryFactory.addVersion(
          "1.0.0",
          "hash/uir",
          treasuryImplementationOne.address
        )
      ).to.emit(treasuryFactory, "VersionCreated");
      const version = await treasuryFactory.versionControl(0);
      expect(version[0]).to.eq("1.0.0");
      expect(version[1]).to.eq("hash/uir");
      expect(version[2]).to.eq(treasuryImplementationOne.address);
    });

    it("treasury returns correct factory", async () => {
      await expect(await treasury.moduleFactory()).to.equal(
        treasuryFactory.address
      );
    });
    it("Can predict DAO and Access Control", async () => {
      const { chainId } = await ethers.provider.getNetwork();
      const abiCoder = new ethers.utils.AbiCoder();
      const predictedTreasury = ethers.utils.getCreate2Address(
        treasuryFactory.address,
        ethers.utils.solidityKeccak256(
          ["address", "uint256", "bytes32"],
          [deployer.address, chainId, ethers.utils.formatBytes32String("hi")]
        ),
        ethers.utils.solidityKeccak256(
          ["bytes", "bytes"],
          // eslint-disable-next-line camelcase
          [
            ERC1967Proxy__factory.bytecode,
            abiCoder.encode(
              ["address", "bytes"],
              [treasuryImplementationOne.address, []]
            ),
          ]
        )
      );

      // eslint-disable-next-line no-unused-expressions
      expect(treasury.address).to.eq(predictedTreasury);
    });
  });

  describe("Supports authorized upgradeability", function () {
    beforeEach(async function () {
      [deployer, withdrawer, userA, userB, upgrader] =
        await ethers.getSigners();

      dao = await new DAO__factory(deployer).deploy();
      accessControl = await new AccessControlDAO__factory(deployer).deploy();
      treasuryFactory = await new TreasuryModuleFactory__factory(
        deployer
      ).deploy();
      treasuryImplementationOne = await new TreasuryModule__factory(
        deployer
      ).deploy();
      treasuryImplementationTwo = await new TreasuryModule__factory(
        deployer
      ).deploy();

      const treasuryAddress = await createTreasuryFromFactory(
        deployer,
        treasuryFactory,
        accessControl.address,
        treasuryImplementationOne.address,
        ethers.utils.formatBytes32String("hi")
      );

      // eslint-disable-next-line camelcase
      treasury = TreasuryModule__factory.connect(treasuryAddress, deployer);

      await accessControl
        .connect(deployer)
        .initialize(
          dao.address,
          [withdrawerRoleString, upgraderRoleString],
          [daoRoleString, daoRoleString],
          [[withdrawer.address], [upgrader.address]],
          [
            treasury.address,
            treasury.address,
            treasury.address,
            treasury.address,
            treasury.address,
            treasury.address,
          ],
          [
            "withdrawEth(address[],uint256[])",
            "depositERC20Tokens(address[],address[],uint256[])",
            "withdrawERC20Tokens(address[],address[],uint256[])",
            "depositERC721Tokens(address[],address[],uint256[])",
            "withdrawERC721Tokens(address[],address[],uint256[])",
            "upgradeTo(address)",
          ],
          [
            [withdrawerRoleString],
            [withdrawerRoleString],
            [withdrawerRoleString],
            [withdrawerRoleString],
            [withdrawerRoleString],
            [upgraderRoleString],
          ]
        );

      await TreasuryDepositEth(
        treasury,
        deployer,
        ethers.utils.parseUnits("10", 18)
      );
    });

    it("Can be upgraded by an authorized user", async () => {
      await expect(
        treasury.connect(upgrader).upgradeTo(treasuryImplementationTwo.address)
      ).to.emit(treasury, "Upgraded");
    });

    it("Cannot be upgraded by an unauthorized user", async () => {
      await expect(
        treasury.connect(deployer).upgradeTo(treasuryImplementationTwo.address)
      ).to.be.revertedWith("NotAuthorized()");

      await expect(
        treasury
          .connect(withdrawer)
          .upgradeTo(treasuryImplementationTwo.address)
      ).to.be.revertedWith("NotAuthorized()");

      await expect(
        treasury.connect(userA).upgradeTo(treasuryImplementationTwo.address)
      ).to.be.revertedWith("NotAuthorized()");

      await expect(
        treasury.connect(userB).upgradeTo(treasuryImplementationTwo.address)
      ).to.be.revertedWith("NotAuthorized()");
    });
  });

  describe("Treasury supports Ether", function () {
    beforeEach(async function () {
      [deployer, withdrawer, userA, userB, upgrader] =
        await ethers.getSigners();

      dao = await new DAO__factory(deployer).deploy();
      accessControl = await new AccessControlDAO__factory(deployer).deploy();
      treasuryFactory = await new TreasuryModuleFactory__factory(
        deployer
      ).deploy();
      treasuryImplementationOne = await new TreasuryModule__factory(
        deployer
      ).deploy();
      treasuryImplementationTwo = await new TreasuryModule__factory(
        deployer
      ).deploy();

      const treasuryAddress = await createTreasuryFromFactory(
        deployer,
        treasuryFactory,
        accessControl.address,
        treasuryImplementationOne.address,
        ethers.utils.formatBytes32String("hi")
      );

      // eslint-disable-next-line camelcase
      treasury = TreasuryModule__factory.connect(treasuryAddress, deployer);

      await accessControl
        .connect(deployer)
        .initialize(
          dao.address,
          [withdrawerRoleString],
          [daoRoleString],
          [[withdrawer.address]],
          [
            treasury.address,
            treasury.address,
            treasury.address,
            treasury.address,
            treasury.address,
          ],
          [
            "withdrawEth(address[],uint256[])",
            "depositERC20Tokens(address[],address[],uint256[])",
            "withdrawERC20Tokens(address[],address[],uint256[])",
            "depositERC721Tokens(address[],address[],uint256[])",
            "withdrawERC721Tokens(address[],address[],uint256[])",
          ],
          [
            [withdrawerRoleString],
            [withdrawerRoleString],
            [withdrawerRoleString],
            [withdrawerRoleString],
            [withdrawerRoleString],
          ]
        );

      await TreasuryDepositEth(
        treasury,
        deployer,
        ethers.utils.parseUnits("10", 18)
      );
    });

    it("Supports the expected ERC165 interface", async () => {
      // Supports Module Factory interface
      expect(
        await treasuryFactory.supportsInterface(
          // eslint-disable-next-line camelcase
          getInterfaceSelector(IModuleFactory__factory.createInterface())
        )
      ).to.eq(true);
      // Supports ERC-165 interface
      expect(await treasuryFactory.supportsInterface("0x01ffc9a7")).to.eq(true);
    });

    it("Receives Ether", async () => {
      expect(await treasury.provider.getBalance(treasury.address)).to.equal(
        ethers.utils.parseUnits("10", 18)
      );
    });

    it("Emits an event when ETH is withdrawn", async () => {
      const withdrawEvent = await TreasuryWithdrawEth(
        treasury,
        withdrawer,
        [userA.address],
        [ethers.utils.parseUnits("1", 18)]
      );

      expect(withdrawEvent.recipients).to.deep.equal([userA.address]);
      expect(withdrawEvent.amounts).to.deep.equal([
        ethers.utils.parseUnits("1", 18),
      ]);
    });

    it("Sends Eth using the withdraw function", async () => {
      const userABalanceBefore = await userA.getBalance();

      await TreasuryWithdrawEth(
        treasury,
        withdrawer,
        [userA.address],
        [ethers.utils.parseUnits("1", 18)]
      );

      expect((await userA.getBalance()).sub(userABalanceBefore)).to.equal(
        ethers.utils.parseUnits("1", 18)
      );

      expect(await treasury.provider.getBalance(treasury.address)).to.equal(
        ethers.utils.parseUnits("9", 18)
      );
    });

    it("Sends ETH to multiple addresses using the withdraw function", async () => {
      const userABalanceBefore = await userA.getBalance();
      const userBBalanceBefore = await userB.getBalance();

      await TreasuryWithdrawEth(
        treasury,
        withdrawer,
        [userA.address, userB.address],
        [ethers.utils.parseUnits("1", 18), ethers.utils.parseUnits("2", 18)]
      );

      expect((await userA.getBalance()).sub(userABalanceBefore)).to.equal(
        ethers.utils.parseUnits("1", 18)
      );

      expect((await userB.getBalance()).sub(userBBalanceBefore)).to.equal(
        ethers.utils.parseUnits("2", 18)
      );

      expect(await treasury.provider.getBalance(treasury.address)).to.equal(
        ethers.utils.parseUnits("7", 18)
      );
    });

    it("Reverts when a non-owner attempts to withdraw ETH", async () => {
      await expect(
        TreasuryWithdrawEth(
          treasury,
          userA,
          [userA.address],
          [ethers.utils.parseUnits("1", 18)]
        )
      ).to.be.revertedWith("NotAuthorized()");

      await expect(
        TreasuryWithdrawEth(
          treasury,
          userB,
          [userB.address],
          [ethers.utils.parseUnits("1", 18)]
        )
      ).to.be.revertedWith("NotAuthorized()");
    });

    it("Reverts when the withdraw function is called with inequal array lengths", async () => {
      await expect(
        TreasuryWithdrawEth(
          treasury,
          withdrawer,
          [userA.address, userB.address],
          [ethers.utils.parseUnits("1", 18)]
        )
      ).to.be.revertedWith("UnequalArrayLengths()");

      await expect(
        TreasuryWithdrawEth(
          treasury,
          withdrawer,
          [userA.address],
          [ethers.utils.parseUnits("1", 18), ethers.utils.parseUnits("1", 18)]
        )
      ).to.be.revertedWith("UnequalArrayLengths()");
    });
  });

  describe("Treasury supports ERC-20 tokens", function () {
    beforeEach(async function () {
      [deployer, withdrawer, userA, userB] = await ethers.getSigners();

      dao = await new DAO__factory(deployer).deploy();
      accessControl = await new AccessControlDAO__factory(deployer).deploy();
      treasuryFactory = await new TreasuryModuleFactory__factory(
        deployer
      ).deploy();
      treasuryImplementationOne = await new TreasuryModule__factory(
        deployer
      ).deploy();
      treasuryImplementationTwo = await new TreasuryModule__factory(
        deployer
      ).deploy();

      const treasuryAddress = await createTreasuryFromFactory(
        deployer,
        treasuryFactory,
        accessControl.address,
        treasuryImplementationOne.address,
        ethers.utils.formatBytes32String("hi")
      );

      // eslint-disable-next-line camelcase
      treasury = TreasuryModule__factory.connect(treasuryAddress, deployer);

      await accessControl
        .connect(deployer)
        .initialize(
          dao.address,
          [withdrawerRoleString],
          [daoRoleString],
          [[withdrawer.address]],
          [
            treasury.address,
            treasury.address,
            treasury.address,
            treasury.address,
            treasury.address,
          ],
          [
            "withdrawEth(address[],uint256[])",
            "depositERC20Tokens(address[],address[],uint256[])",
            "withdrawERC20Tokens(address[],address[],uint256[])",
            "depositERC721Tokens(address[],address[],uint256[])",
            "withdrawERC721Tokens(address[],address[],uint256[])",
          ],
          [
            [withdrawerRoleString],
            [withdrawerRoleString],
            [withdrawerRoleString],
            [withdrawerRoleString],
            [withdrawerRoleString],
          ]
        );

      erc20TokenAlpha = await new VotesTokenWithSupply__factory(
        deployer
      ).deploy(
        "ALPHA",
        "ALPHA",
        [treasury.address, userA.address, userB.address],
        [
          ethers.utils.parseUnits("100.0", 18),
          ethers.utils.parseUnits("100.0", 18),
          ethers.utils.parseUnits("100.0", 18),
        ],
        ethers.utils.parseUnits("300", 18),
        treasury.address
      );

      erc20TokenBravo = await new VotesTokenWithSupply__factory(
        deployer
      ).deploy(
        "BRAVO",
        "BRAVO",
        [treasury.address, userA.address, userB.address],
        [
          ethers.utils.parseUnits("100.0", 18),
          ethers.utils.parseUnits("100.0", 18),
          ethers.utils.parseUnits("100.0", 18),
        ],
        ethers.utils.parseUnits("300", 18),
        treasury.address
      );

      await erc20TokenAlpha
        .connect(userA)
        .approve(treasury.address, ethers.utils.parseUnits("100.0", 18));

      await erc20TokenAlpha
        .connect(userB)
        .approve(treasury.address, ethers.utils.parseUnits("100.0", 18));

      await erc20TokenBravo
        .connect(userA)
        .approve(treasury.address, ethers.utils.parseUnits("100.0", 18));

      await erc20TokenBravo
        .connect(userB)
        .approve(treasury.address, ethers.utils.parseUnits("100.0", 18));
    });

    it("Receives ERC-20 tokens", async () => {
      expect(await erc20TokenAlpha.balanceOf(userA.address)).to.equal(
        ethers.utils.parseUnits("100.0", 18)
      );
      expect(await erc20TokenAlpha.balanceOf(userB.address)).to.equal(
        ethers.utils.parseUnits("100.0", 18)
      );
      expect(await erc20TokenAlpha.balanceOf(treasury.address)).to.equal(
        ethers.utils.parseUnits("100.0", 18)
      );
      expect(await erc20TokenBravo.balanceOf(userA.address)).to.equal(
        ethers.utils.parseUnits("100.0", 18)
      );
      expect(await erc20TokenBravo.balanceOf(userB.address)).to.equal(
        ethers.utils.parseUnits("100.0", 18)
      );
      expect(await erc20TokenBravo.balanceOf(treasury.address)).to.equal(
        ethers.utils.parseUnits("100.0", 18)
      );
    });

    it("Emits event when ERC-20 tokens are deposited", async () => {
      const depositEvent = await TreasuryDepositERC20Tokens(
        treasury,
        withdrawer,
        [erc20TokenAlpha.address],
        [userA.address],
        [ethers.utils.parseUnits("50.0", 18)]
      );

      expect(depositEvent.tokenAddresses).to.deep.equal([
        erc20TokenAlpha.address,
      ]);
      expect(depositEvent.senders).to.deep.equal([userA.address]);
      expect(depositEvent.amounts).to.deep.equal([
        ethers.utils.parseUnits("50.0", 18),
      ]);
    });

    it("Receives ERC-20 tokens using the deposit function", async () => {
      await TreasuryDepositERC20Tokens(
        treasury,
        withdrawer,
        [erc20TokenAlpha.address],
        [userA.address],
        [ethers.utils.parseUnits("50.0", 18)]
      );

      expect(await erc20TokenAlpha.balanceOf(userA.address)).to.equal(
        ethers.utils.parseUnits("50.0", 18)
      );
      expect(await erc20TokenAlpha.balanceOf(treasury.address)).to.equal(
        ethers.utils.parseUnits("150.0", 18)
      );
    });

    it("Receives multiple ERC-20 tokens from multiple addresses using the deposit function", async () => {
      await TreasuryDepositERC20Tokens(
        treasury,
        withdrawer,
        [erc20TokenAlpha.address],
        [userA.address],
        [ethers.utils.parseUnits("20.0", 18)]
      );

      await TreasuryDepositERC20Tokens(
        treasury,
        withdrawer,
        [erc20TokenAlpha.address],
        [userB.address],
        [ethers.utils.parseUnits("30.0", 18)]
      );

      await TreasuryDepositERC20Tokens(
        treasury,
        withdrawer,
        [erc20TokenBravo.address],
        [userA.address],
        [ethers.utils.parseUnits("40.0", 18)]
      );

      await TreasuryDepositERC20Tokens(
        treasury,
        withdrawer,
        [erc20TokenBravo.address],
        [userB.address],
        [ethers.utils.parseUnits("50.0", 18)]
      );

      expect(await erc20TokenAlpha.balanceOf(userA.address)).to.equal(
        ethers.utils.parseUnits("80.0", 18)
      );

      expect(await erc20TokenAlpha.balanceOf(userB.address)).to.equal(
        ethers.utils.parseUnits("70.0", 18)
      );

      expect(await erc20TokenAlpha.balanceOf(treasury.address)).to.equal(
        ethers.utils.parseUnits("150.0", 18)
      );

      expect(await erc20TokenBravo.balanceOf(userA.address)).to.equal(
        ethers.utils.parseUnits("60.0", 18)
      );

      expect(await erc20TokenBravo.balanceOf(userB.address)).to.equal(
        ethers.utils.parseUnits("50.0", 18)
      );

      expect(await erc20TokenBravo.balanceOf(treasury.address)).to.equal(
        ethers.utils.parseUnits("190.0", 18)
      );
    });

    it("Emits event when ERC-20 tokens are withdrawn", async () => {
      const withdrawEvent = await TreasuryWithdrawERC20Tokens(
        treasury,
        withdrawer,
        [erc20TokenAlpha.address],
        [userA.address],
        [ethers.utils.parseUnits("50.0", 18)]
      );

      expect(withdrawEvent.tokenAddresses).to.deep.equal([
        erc20TokenAlpha.address,
      ]);
      expect(withdrawEvent.recipients).to.deep.equal([userA.address]);
      expect(withdrawEvent.amounts).to.deep.equal([
        ethers.utils.parseUnits("50.0", 18),
      ]);
    });

    it("Sends ERC-20 tokens using the withdraw function", async () => {
      await TreasuryWithdrawERC20Tokens(
        treasury,
        withdrawer,
        [erc20TokenAlpha.address],
        [userA.address],
        [ethers.utils.parseUnits("50.0", 18)]
      );

      expect(await erc20TokenAlpha.balanceOf(userA.address)).to.equal(
        ethers.utils.parseUnits("150.0", 18)
      );
      expect(await erc20TokenAlpha.balanceOf(treasury.address)).to.equal(
        ethers.utils.parseUnits("50.0", 18)
      );
    });

    it("Sends multiple ERC-20 tokens to multiple addresses using the withdraw function", async () => {
      await TreasuryWithdrawERC20Tokens(
        treasury,
        withdrawer,
        [erc20TokenAlpha.address],
        [userA.address],
        [ethers.utils.parseUnits("20.0", 18)]
      );

      await TreasuryWithdrawERC20Tokens(
        treasury,
        withdrawer,
        [erc20TokenAlpha.address],
        [userB.address],
        [ethers.utils.parseUnits("30.0", 18)]
      );

      await TreasuryWithdrawERC20Tokens(
        treasury,
        withdrawer,
        [erc20TokenBravo.address],
        [userA.address],
        [ethers.utils.parseUnits("40.0", 18)]
      );

      await TreasuryWithdrawERC20Tokens(
        treasury,
        withdrawer,
        [erc20TokenBravo.address],
        [userB.address],
        [ethers.utils.parseUnits("50.0", 18)]
      );

      expect(await erc20TokenAlpha.balanceOf(userA.address)).to.equal(
        ethers.utils.parseUnits("120.0", 18)
      );

      expect(await erc20TokenAlpha.balanceOf(userB.address)).to.equal(
        ethers.utils.parseUnits("130.0", 18)
      );

      expect(await erc20TokenAlpha.balanceOf(treasury.address)).to.equal(
        ethers.utils.parseUnits("50.0", 18)
      );

      expect(await erc20TokenBravo.balanceOf(userA.address)).to.equal(
        ethers.utils.parseUnits("140.0", 18)
      );

      expect(await erc20TokenBravo.balanceOf(userB.address)).to.equal(
        ethers.utils.parseUnits("150.0", 18)
      );

      expect(await erc20TokenBravo.balanceOf(treasury.address)).to.equal(
        ethers.utils.parseUnits("10.0", 18)
      );
    });

    it("Reverts when a non authorized user attempts to withdraw ERC-20 tokens", async () => {
      await expect(
        TreasuryWithdrawERC20Tokens(
          treasury,
          userA,
          [erc20TokenBravo.address],
          [userB.address],
          [ethers.utils.parseUnits("50.0", 18)]
        )
      ).to.be.revertedWith("NotAuthorized()");
    });

    it("Reverts when the deposit function is called with inequal array lengths", async () => {
      await expect(
        TreasuryDepositERC20Tokens(
          treasury,
          withdrawer,
          [erc20TokenAlpha.address, erc20TokenBravo.address],
          [userA.address],
          [ethers.utils.parseUnits("50.0", 18)]
        )
      ).to.be.revertedWith("UnequalArrayLengths()");

      await expect(
        TreasuryDepositERC20Tokens(
          treasury,
          withdrawer,
          [erc20TokenAlpha.address],
          [userA.address, userB.address],
          [ethers.utils.parseUnits("50.0", 18)]
        )
      ).to.be.revertedWith("UnequalArrayLengths()");

      await expect(
        TreasuryDepositERC20Tokens(
          treasury,
          withdrawer,
          [erc20TokenAlpha.address],
          [userA.address],
          [
            ethers.utils.parseUnits("50.0", 18),
            ethers.utils.parseUnits("50.0", 18),
          ]
        )
      ).to.be.revertedWith("UnequalArrayLengths()");
    });

    it("Reverts when the withdraw function is called with inequal array lengths", async () => {
      await expect(
        TreasuryWithdrawERC20Tokens(
          treasury,
          withdrawer,
          [erc20TokenAlpha.address, erc20TokenBravo.address],
          [userA.address],
          [ethers.utils.parseUnits("50.0", 18)]
        )
      ).to.be.revertedWith("UnequalArrayLengths()");

      await expect(
        TreasuryWithdrawERC20Tokens(
          treasury,
          withdrawer,
          [erc20TokenAlpha.address],
          [userA.address, userB.address],
          [ethers.utils.parseUnits("50.0", 18)]
        )
      ).to.be.revertedWith("UnequalArrayLengths()");

      await expect(
        TreasuryWithdrawERC20Tokens(
          treasury,
          withdrawer,
          [erc20TokenAlpha.address],
          [userA.address],
          [
            ethers.utils.parseUnits("50.0", 18),
            ethers.utils.parseUnits("50.0", 18),
          ]
        )
      ).to.be.revertedWith("UnequalArrayLengths()");
    });
  });

  describe("Treasury supports ERC-721 tokens", function () {
    beforeEach(async function () {
      [deployer, withdrawer, userA, userB] = await ethers.getSigners();

      dao = await new DAO__factory(deployer).deploy();
      accessControl = await new AccessControlDAO__factory(deployer).deploy();
      treasuryFactory = await new TreasuryModuleFactory__factory(
        deployer
      ).deploy();
      treasuryImplementationOne = await new TreasuryModule__factory(
        deployer
      ).deploy();
      treasuryImplementationTwo = await new TreasuryModule__factory(
        deployer
      ).deploy();

      const treasuryAddress = await createTreasuryFromFactory(
        deployer,
        treasuryFactory,
        accessControl.address,
        treasuryImplementationOne.address,
        ethers.utils.formatBytes32String("hi")
      );

      // eslint-disable-next-line camelcase
      treasury = TreasuryModule__factory.connect(treasuryAddress, deployer);

      await accessControl
        .connect(deployer)
        .initialize(
          dao.address,
          [withdrawerRoleString],
          [daoRoleString],
          [[withdrawer.address]],
          [
            treasury.address,
            treasury.address,
            treasury.address,
            treasury.address,
            treasury.address,
          ],
          [
            "withdrawEth(address[],uint256[])",
            "depositERC20Tokens(address[],address[],uint256[])",
            "withdrawERC20Tokens(address[],address[],uint256[])",
            "depositERC721Tokens(address[],address[],uint256[])",
            "withdrawERC721Tokens(address[],address[],uint256[])",
          ],
          [
            [withdrawerRoleString],
            [withdrawerRoleString],
            [withdrawerRoleString],
            [withdrawerRoleString],
            [withdrawerRoleString],
          ]
        );

      erc721TokenAlpha = await new MockERC721__factory(deployer).deploy(
        "ALPHA",
        "ALPHA",
        [treasury.address, treasury.address, userA.address, userB.address],
        [
          BigNumber.from("0"),
          BigNumber.from("1"),
          BigNumber.from("2"),
          BigNumber.from("3"),
        ]
      );

      erc721TokenBravo = await new MockERC721__factory(deployer).deploy(
        "BRAVO",
        "BRAVO",
        [treasury.address, treasury.address, userA.address, userB.address],
        [
          BigNumber.from("0"),
          BigNumber.from("1"),
          BigNumber.from("2"),
          BigNumber.from("3"),
        ]
      );

      await erc721TokenAlpha
        .connect(userA)
        .approve(treasury.address, BigNumber.from("2"));

      await erc721TokenAlpha
        .connect(userB)
        .approve(treasury.address, BigNumber.from("3"));

      await erc721TokenBravo
        .connect(userA)
        .approve(treasury.address, BigNumber.from("2"));

      await erc721TokenBravo
        .connect(userB)
        .approve(treasury.address, BigNumber.from("3"));
    });

    it("Receives ERC-721 tokens", async () => {
      expect(await erc721TokenAlpha.ownerOf(BigNumber.from("0"))).to.equal(
        treasury.address
      );
      expect(await erc721TokenAlpha.ownerOf(BigNumber.from("1"))).to.equal(
        treasury.address
      );

      expect(await erc721TokenAlpha.ownerOf(BigNumber.from("2"))).to.equal(
        userA.address
      );
      expect(await erc721TokenAlpha.ownerOf(BigNumber.from("3"))).to.equal(
        userB.address
      );
      expect(await erc721TokenBravo.ownerOf(BigNumber.from("0"))).to.equal(
        treasury.address
      );
      expect(await erc721TokenBravo.ownerOf(BigNumber.from("1"))).to.equal(
        treasury.address
      );
      expect(await erc721TokenBravo.ownerOf(BigNumber.from("2"))).to.equal(
        userA.address
      );
      expect(await erc721TokenBravo.ownerOf(BigNumber.from("3"))).to.equal(
        userB.address
      );
    });

    it("Emits an event when ERC-721 tokens are deposited", async () => {
      const depositEvent = await TreasuryDepositERC721Tokens(
        treasury,
        withdrawer,
        [erc721TokenAlpha.address],
        [userA.address],
        [BigNumber.from("2")]
      );

      expect(depositEvent.tokenAddresses).to.deep.equal([
        erc721TokenAlpha.address,
      ]);
      expect(depositEvent.senders).to.deep.equal([userA.address]);
      expect(depositEvent.tokenIds).to.deep.equal([BigNumber.from("2")]);
    });

    it("Receives ERC-721 tokens using the deposit function", async () => {
      await TreasuryDepositERC721Tokens(
        treasury,
        withdrawer,
        [erc721TokenAlpha.address],
        [userA.address],
        [BigNumber.from("2")]
      );

      expect(await erc721TokenAlpha.ownerOf(BigNumber.from("2"))).to.equal(
        treasury.address
      );
    });

    it("Receives multiple ERC-721 tokens from multiple addresses using the deposit function", async () => {
      await TreasuryDepositERC721Tokens(
        treasury,
        withdrawer,
        [erc721TokenAlpha.address],
        [userA.address],
        [BigNumber.from("2")]
      );

      await TreasuryDepositERC721Tokens(
        treasury,
        withdrawer,
        [erc721TokenAlpha.address],
        [userB.address],
        [BigNumber.from("3")]
      );

      await TreasuryDepositERC721Tokens(
        treasury,
        withdrawer,
        [erc721TokenBravo.address],
        [userA.address],
        [BigNumber.from("2")]
      );

      await TreasuryDepositERC721Tokens(
        treasury,
        withdrawer,
        [erc721TokenBravo.address],
        [userB.address],
        [BigNumber.from("3")]
      );

      expect(await erc721TokenAlpha.ownerOf(BigNumber.from("2"))).to.equal(
        treasury.address
      );

      expect(await erc721TokenAlpha.ownerOf(BigNumber.from("3"))).to.equal(
        treasury.address
      );

      expect(await erc721TokenBravo.ownerOf(BigNumber.from("2"))).to.equal(
        treasury.address
      );

      expect(await erc721TokenBravo.ownerOf(BigNumber.from("3"))).to.equal(
        treasury.address
      );
    });

    it("Emits an event when ERC-721 tokens are withdrawn", async () => {
      const withdrawEvent = await TreasuryWithdrawERC721Tokens(
        treasury,
        withdrawer,
        [erc721TokenAlpha.address],
        [userA.address],
        [BigNumber.from("0")]
      );

      expect(withdrawEvent.tokenAddresses).to.deep.equal([
        erc721TokenAlpha.address,
      ]);
      expect(withdrawEvent.recipients).to.deep.equal([userA.address]);
      expect(withdrawEvent.tokenIds).to.deep.equal([BigNumber.from("0")]);
    });

    it("Sends ERC-721 tokens using the withdraw function", async () => {
      await TreasuryWithdrawERC721Tokens(
        treasury,
        withdrawer,
        [erc721TokenAlpha.address],
        [userA.address],
        [BigNumber.from("0")]
      );

      expect(await erc721TokenAlpha.ownerOf(BigNumber.from("0"))).to.equal(
        userA.address
      );
    });

    it("Sends multiple ERC-721 tokens to multiple addresses using the withdraw function", async () => {
      await TreasuryWithdrawERC721Tokens(
        treasury,
        withdrawer,
        [erc721TokenAlpha.address],
        [userA.address],
        [BigNumber.from("0")]
      );

      await TreasuryWithdrawERC721Tokens(
        treasury,
        withdrawer,
        [erc721TokenAlpha.address],
        [userB.address],
        [BigNumber.from("1")]
      );

      await TreasuryWithdrawERC721Tokens(
        treasury,
        withdrawer,
        [erc721TokenBravo.address],
        [userA.address],
        [BigNumber.from("0")]
      );

      await TreasuryWithdrawERC721Tokens(
        treasury,
        withdrawer,
        [erc721TokenBravo.address],
        [userB.address],
        [BigNumber.from("1")]
      );

      expect(await erc721TokenAlpha.ownerOf(BigNumber.from("0"))).to.equal(
        userA.address
      );

      expect(await erc721TokenAlpha.ownerOf(BigNumber.from("1"))).to.equal(
        userB.address
      );

      expect(await erc721TokenBravo.ownerOf(BigNumber.from("0"))).to.equal(
        userA.address
      );

      expect(await erc721TokenBravo.ownerOf(BigNumber.from("1"))).to.equal(
        userB.address
      );
    });

    it("Reverts when a non-owner attempts to withdraw ERC-721 tokens", async () => {
      await expect(
        TreasuryWithdrawERC721Tokens(
          treasury,
          userA,
          [erc721TokenAlpha.address],
          [userA.address],
          [BigNumber.from("0")]
        )
      ).to.be.revertedWith("NotAuthorized()");

      await expect(
        TreasuryWithdrawERC721Tokens(
          treasury,
          userB,
          [erc721TokenAlpha.address],
          [userA.address],
          [BigNumber.from("0")]
        )
      ).to.be.revertedWith("NotAuthorized()");
    });

    it("Reverts when the deposit function is called with inequal array lengths", async () => {
      await expect(
        TreasuryDepositERC721Tokens(
          treasury,
          withdrawer,
          [erc721TokenAlpha.address, erc721TokenBravo.address],
          [userA.address],
          [BigNumber.from("2")]
        )
      ).to.be.revertedWith("UnequalArrayLengths()");

      await expect(
        TreasuryDepositERC721Tokens(
          treasury,
          withdrawer,
          [erc721TokenAlpha.address],
          [userA.address, userB.address],
          [BigNumber.from("3")]
        )
      ).to.be.revertedWith("UnequalArrayLengths()");

      await expect(
        TreasuryDepositERC721Tokens(
          treasury,
          withdrawer,
          [erc721TokenAlpha.address],
          [userA.address],
          [BigNumber.from("2"), BigNumber.from("3")]
        )
      ).to.be.revertedWith("UnequalArrayLengths()");
    });

    it("Reverts when the withdraw function is called with inequal array lengths", async () => {
      await expect(
        TreasuryWithdrawERC721Tokens(
          treasury,
          withdrawer,
          [erc721TokenAlpha.address, erc721TokenBravo.address],
          [userA.address],
          [BigNumber.from("0")]
        )
      ).to.be.revertedWith("UnequalArrayLengths()");

      await expect(
        TreasuryWithdrawERC721Tokens(
          treasury,
          withdrawer,
          [erc721TokenAlpha.address],
          [userA.address, userB.address],
          [BigNumber.from("0")]
        )
      ).to.be.revertedWith("UnequalArrayLengths()");

      await expect(
        TreasuryWithdrawERC20Tokens(
          treasury,
          withdrawer,
          [erc721TokenAlpha.address],
          [userA.address],
          [BigNumber.from("0"), BigNumber.from("1")]
        )
      ).to.be.revertedWith("UnequalArrayLengths()");
    });
  });
});
