
const NormalSdk = require("@normalframework/applications-sdk");
const { InvokeSuccess, InvokeError } = NormalSdk;
const { v5: uuidv5 } = require("uuid");
var s = require('net');
var http;

const INNCOM_SOCKET = 3301;

/**
 * Invoke hook function
 * @param {NormalSdk.InvokeParams} params
 * @returns {NormalSdk.InvokeResult}
 */
module.exports = async ({points, sdk, config}) => {
	// this module assumes that there is already an active global connection to the InnCom WSCon stream
 	BASE_URL = config.baseUrl;
	SITE_ID = config.siteId;
	http = sdk.http;
	http.defaults.headers = { "x-api-key": config.apiKey };
	var packet = '';
	var header = 'ff83000d0000000000000000';
	var room = 0;
	var code = 0;
	var sroom = '';
	var scode = '';
	var pvalue = 0;
	
	sdk.logEvent(`Received update for ${points.length} points.`);

	for (const update of points) {
		if (update.latestValue.meta?.changeKind !== "CHANGE_KIND_BACNET_WRITE") {
			sdk.logEvent('Ignoring update from ${update.uuid}. Was not a bacnet write.');
		}
		else {
			sdk.logEvent(`Processing update for ${update.uuid}. Setting to ${update.latestValue.value}.`);
			console.log(`room:${update.attrs[1000]} code:${update.attrs[1001]}`);
			// validate point value
			pvalue = parseInt(update.latestValue.value);
			if (isNaN(pvalue)) {
				sdk.logEvent('Invalid value');
			}
			else {
				room = parseInt(update.attrs[1000]);
				code = parseInt(update.attrs[1001]);
				sroom = room.toString(16).padStart(4,'0');
				scode = code.toString(16).padStart(4,'0');

				// process each writable point baed on control code
				switch (code) {
					case 32:
						// dnd
						if (pvalue >= 0 && pvalue <= 2) {
							packet = packet + header + sroom + '0000000000' + scode + pvalue.toString(16).padStart(4,'0') + '0000';
						}
						else
							sdk.logEvent('Invalid value');
						break;
					case 33:
						// mur
						if (pvalue >= 0 && pvalue <= 2) {
							packet = packet + header + sroom + '0000000000' + scode + pvalue.toString(16).padStart(4,'0') + '0000';
						}
						else
							sdk.logEvent('Invalid value');
						break;
					case 63:
						// target temp
						if (pvalue >= 0 && pvalue <= 200) {
							packet = packet + header + sroom + '0000000000' + scode + (pvalue * 10).toString(16).padStart(4,'0') + '0000';
						}
						else
							sdk.logEvent('Invalid value');
						break;
					case 65:
						// mode
						if (pvalue >= 0 && pvalue <= 3) {
							packet = packet + header + sroom + '0000000000' + scode + pvalue.toString(16).padStart(4,'0') + '0000';
						}
						else
							sdk.logEvent('Invalid value');
						break;
					case 66:
						// fan speed
						if (pvalue >= 1 && pvalue <= 3) {
							packet = packet + header + sroom + '0000000000' + scode + pvalue.toString(16).padStart(4,'0') + '0000';
						}
						else
							sdk.logEvent('Invalid value');
						break;
					case 154:
						// valet
						if (pvalue >= 0 && pvalue <= 2) {
							packet = packet + header + sroom + '0000000000' + scode + pvalue.toString(16).padStart(4,'0') + '0000';
						}
						else
							sdk.logEvent('Invalid value');
						break;
					case 155:
						// foodtray
						if (pvalue >= 0 && pvalue <= 2) {
							packet = packet + header + sroom + '0000000000' + scode + pvalue.toString(16).padStart(4,'0') + '0000';
						}
						else
							sdk.logEvent('Invalid value');
						break;
					case 156:
						// butler
						if (pvalue >= 0 && pvalue <= 2) {
							packet = packet + header + sroom + '0000000000' + scode + pvalue.toString(16).padStart(4,'0') + '0000';
						}
						else
							sdk.logEvent('Invalid value');
						break;
					case 176:
						// eco mode
						if (pvalue == 4 || pvalue == 12) {
							packet = packet + header + sroom + '0000000000' + scode + pvalue.toString(16).padStart(4,'0') + '0000';
						}
						else
							sdk.logEvent('Invalid value');
						break;
					default:
						sdk.logEvent('Point not writable');
				}
			}
		}
	}
	
	// write any packets to read process socket
	if (packet.length > 0) {
		try {
			const client = s.createConnection({ port: INNCOM_SOCKET }, () => {
				client.write(Buffer.from(packet,'hex'));
				console.log('Socket write: ',packet);
			});
			client.on('end', () => {
				console.log('Socket disconnected');
			});
		}
		catch(e) {
			sdk.logEvent(`InnCom socket write error: e`);
		}
	}
}
