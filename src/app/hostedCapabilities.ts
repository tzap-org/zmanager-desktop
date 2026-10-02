/** Build profile switch for hosted account actions and TZAP status checks. */
const buildProfile = import.meta.env.VITE_ZMANAGER_PROFILE;
const hostedCapabilitiesFlag = import.meta.env.VITE_ENABLE_HOSTED_CAPABILITIES;

export const HOSTED_CAPABILITIES_ENABLED = buildProfile
  ? buildProfile === "online"
  : hostedCapabilitiesFlag === "true";
