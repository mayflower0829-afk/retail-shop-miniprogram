const privacy = require('./privacy');
function refresh(page) {
  const accepted = privacy.hasConsent();
  page.setData({ privacyAccepted: accepted, consentChecked: accepted ? false : !!page.data.consentChecked });
  return accepted;
}
module.exports = {
  data: { privacyAccepted: false, consentChecked: false, consentBusy: false, consentError: '' },
  refresh,
  methods: {
    consentChecked(e) { this.setData({ consentChecked: Array.isArray(e.detail.value) && e.detail.value.includes('agree'), consentError: '' }); },
    consentDoc(e) {
      const page = e.currentTarget.dataset.page;
      if (['privacy', 'terms'].includes(page)) wx.navigateTo({ url: '/pages/' + page + '/index' });
    },
    async agreeToTerms() {
      if (this._consentInFlight) return;
      this._consentInFlight = true;
      this.setData({ consentBusy: true, consentError: '' });
      try {
        await privacy.authorizeAndAccept(this.data.consentChecked);
        this.setData({ privacyAccepted: true, consentChecked: false });
        if (this.onConsentGranted) await this.onConsentGranted();
      } catch (e) { this.setData({ consentError: e.message }); }
      finally { this._consentInFlight = false; this.setData({ consentBusy: false }); }
    },
    declineConsent() {
      this.setData({ consentChecked: false, consentError: '', name: '', phone: '', region: [], detail: '', address: null, pickupName: '', pickupPhone: '' });
      wx.switchTab({ url: '/pages/home/index' });
    }
  }
};
