import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {solidity} from 'ethereum-waffle';
import {utils} from 'ethers';
import {ACTION_KEY, ECDSA_TYPE} from '../../../lib/consts';
import TestHelper from '../../testHelper';
import basicERC725 from '../../fixtures/basicERC725';

chai.use(chaiAsPromised);
chai.use(solidity);

const amount = utils.parseEther('0.1');
const data = utils.hexlify(0);

describe('Key holder: approvals', async () => {
  const testHelper = new TestHelper();
  let targetWallet;

  let identity;
  let mockContract;

  let fromManagementWallet;
  let fromActionWallet;
  let fromUnknownWallet;
  let managementKey;
  let actionKey;
  let functionData;
  let targetBalance;
  let targetBalanceAfterSend;
  let addKeyData;

  const isActionKey = () => identity.keyHasPurpose(actionKey, ACTION_KEY);

  beforeEach(async () => {
    ({identity, mockContract, targetWallet, actionKey, managementKey,
      fromManagementWallet, fromActionWallet, fromUnknownWallet} = await testHelper.load(basicERC725));

    targetBalance = await targetWallet.getBalance();
    addKeyData = identity.interface.functions.addKey.encode([actionKey, ACTION_KEY, ECDSA_TYPE]);
    functionData = mockContract.interface.functions.callMe.encode([]);
  });

  describe('Approve with 0 keys needed', () => {
    it('Execute transfer', async () => {
      await identity.execute(targetWallet.address, amount, data);
      const targetBalanceAfterSend = await targetWallet.getBalance();
      expect(targetBalanceAfterSend).to.eq(amount.add(targetBalance));
    });

    it('Execute call on self', async () => {
      await identity.execute(identity.address, 0, addKeyData);
      expect(await isActionKey()).to.be.true;
    });

    it('Execute call', async () => {
      await identity.execute(mockContract.address, 0, functionData);
      expect(await mockContract.wasCalled()).to.be.true;
    });

    it('Will not execute with unknown key', async () => {
      await expect(fromUnknownWallet.execute(mockContract.address, 0, functionData)).to.be.reverted;
    });

    it('Will not execute on self with unknown key', async () => {
      await expect(fromUnknownWallet.execute(identity.address, 0, addKeyData)).to.be.reverted;
    });

    it('Will not execute on self with action key', async () => {
      await expect(fromActionWallet.execute(identity.address, 0, addKeyData)).to.be.reverted;
    });
  });

  describe('Approve with 1 key needed', async () => {
    beforeEach(async () => {
      await identity.setRequiredApprovals(1);
    });
    it('Should add approval successfully', async () => {
      await identity.execute(identity.address, 0, addKeyData);
      await identity.approve(0);
      const approvals = await identity.getExecutionApprovals(0);
      expect(approvals[0]).to.eq(utils.hexlify(managementKey));
    });

    it('Should emit Executed event successfully', async () => {
      await identity.execute(identity.address, 0, addKeyData);
      await expect(identity.approve(0)).to
        .emit(identity, 'Executed')
        .withArgs(0, identity.address, 0, addKeyData);
      expect(await isActionKey()).to.be.true;
    });

    it('Should not allow to approve with unknown key', async () => {
      await identity.execute(identity.address, 0, addKeyData);
      await expect(fromUnknownWallet.approve(0)).to.be.reverted;
    });

    it('Should not allow to approve on self with action key', async () => {
      await identity.execute(identity.address, 0, addKeyData);
      await expect(fromActionWallet.approve(0)).to.be.reverted;
    });

    it('Should not allow to approve non-existent execution', async () => {
      await expect(identity.approve(0)).to.be.reverted;
    });

    it('Execute transfer', async () => {
      await identity.execute(targetWallet.address, amount, data);
      await identity.approve(0);
      targetBalanceAfterSend = await targetWallet.getBalance();
      expect(targetBalanceAfterSend).not.to.eq(targetBalance);
      expect(targetBalanceAfterSend).to.eq(amount.add(targetBalance));
    });

    it('Can not execute twice even when requiredConfirmation increased', async () => {
      await identity.execute(targetWallet.address, amount, data);
      expect(await targetWallet.getBalance()).to.be.eq(targetBalance);

      await identity.approve(0);
      const afterFirstApproveTargetBalance = await targetWallet.getBalance();
      expect(afterFirstApproveTargetBalance).not.to.eq(targetBalance);

      await fromManagementWallet.approve(0);
      const afterSecondApproveTargetBalance = await targetWallet.getBalance();
      expect(afterSecondApproveTargetBalance).to.eq(afterFirstApproveTargetBalance);
    });
  });

  describe('Approve with 2 keys needed', () => {
    beforeEach(async () => {
      await identity.setRequiredApprovals(2);
      await identity.execute(identity.address, 0, addKeyData);
      await identity.execute(mockContract.address, 0, functionData);
    });

    it('Will not approve with used key', async () => {
      await identity.approve(0);
      await expect(identity.approve(0)).to.be.reverted;
    });

    describe('Two management keys', async () => {
      it('Execute transfer', async () => {
        await identity.execute(targetWallet.address, amount, data);
        await identity.approve(2);
        await fromManagementWallet.approve(2);
        targetBalanceAfterSend = await targetWallet.getBalance();
        expect(targetBalanceAfterSend).not.to.eq(targetBalance);
        expect(targetBalanceAfterSend).to.eq(amount.add(targetBalance));
      });

      it('Execute call on self', async () => {
        await fromManagementWallet.approve(0);
        expect(await isActionKey()).to.be.false;
        await identity.approve(0);
        expect(await isActionKey()).to.be.true;
      });

      it('Execute call', async () => {
        await identity.approve(1);
        await fromManagementWallet.approve(1);
        const wasCalled = await mockContract.wasCalled();
        expect(wasCalled).to.be.true;
      });

      it('Will not execute with not enough approvals', async () => {
        await identity.approve(0);
        expect(await isActionKey()).to.be.false;
      });
    });

    describe('One management, one action key', async () => {
      it('Will not execute on self with action key approval', async () => {
        await identity.approve(0);
        await expect(fromActionWallet.approve(0)).to.be.reverted;
      });

      it('Execute call', async () => {
        await identity.approve(1);
        await fromActionWallet.approve(1);
        expect(await mockContract.wasCalled()).to.be.true;
      });

      it('Will not execute with not enough confirmations', async () => {
        await identity.approve(0);
        expect(await isActionKey()).to.be.false;
      });

      it('Execute transfer', async () => {
        await identity.execute(targetWallet.address, amount, data);
        await identity.approve(2);
        await fromActionWallet.approve(2);
        expect(await targetWallet.getBalance()).not.to.eq(targetBalance);
      });
    });
  });
});
