const NormalSdk = require("@normalframework/applications-sdk");
const { InvokeSuccess, InvokeError } = NormalSdk;
const { v5: uuidv5 } = require("uuid");
var http;

/**
 * Invoke hook function
 * @param {NormalSdk.InvokeParams} params
 * @returns {NormalSdk.InvokeResult}
 */
module.exports = async ({points, sdk, update, args}) => {
    
    var s = require('net');
    http = sdk.http;

    // each inncom packet has a 12 byte header with byte 1 the type and byte 3 the payload length
    // initial startup packet with header, 4 byte app id, 4 byte capability flags then \r driver name 00 and \r host name 00
    const p_startup = Buffer.from(['0xff', '0xff', '0x00', '0x24', '0x00', '0x00', '0x00', '0x00', '0x00', '0x00', '0x00', '0x00',
        '0xff', '0xff', '0xff', '0x81', '0x00', '0x00', '0x00', '0x00', 
        '0x0d', '0x4E', '0x65', '0x75', '0x72', '0x6F', '0x20', '0x42', '0x41', '0x43', '0x6E', '0x65', '0x74', '0x00', 
        '0x0d', '0x4E', '0x65', '0x75', '0x72', '0x6F', '0x20', '0x49', '0x6E', '0x6E', '0x43', '0x6F', '0x6D', '0x00']);
    // beacon packet, header only
    const p_beacon = Buffer.from(['0xff', '0xfe', '0x00', '0x00', '0x00', '0x00', '0x00', '0x00', '0x00', '0x00', '0x00', '0x00']);
    // full sync packet with FFFF payload
    const p_fullsync = Buffer.from(['0xff', '0xa3', '0x00', '0x02', '0x00', '0x00', '0x00', '0x00', '0x00', '0x00', '0x00', '0x00', '0xff', '0xff']);
    var sync_complete = true;
	var temp = null;

	const INNCOM_IP = '10.16.0.113';
	const INNCOM_PORT = 3002;
	const INNCOM_SOCKET = 3301;

    try {
		if (typeof global.inncom_client === 'undefined') {
			global.inncom_client = s.connect(INNCOM_PORT, INNCOM_IP, function() {
				console.log('client connected');
				sync_complete = false;
			});
		}

        // listen for packet and process
        global.inncom_client.on('data', function(d) {
            // grab packet as string
            var msg = d.toString('hex');
            console.log(msg);
            // grab packet type
            var p_type = msg.substr(2,2).toLowerCase();
            // housekeeping - if startup, send app id response to register for write requests
            if (p_type == 'ff') {
                global.inncom_client.write(p_startup); 
                console.log('client registered');
				if (sync_complete === false) {
					sync_complete = true;
					global.inncom_client.write(p_fullsync); 
					console.log('full sync requested');
				}
            }
            // housekeeping - if beacon, send our own, should send each minute
            if (p_type == 'fe') {
                global.inncom_client.write(p_beacon); 
                console.log('beacon sent');
            }
            // housekeeping - if sync result
            if (p_type == 'ac') {
                // a zero payload means done, otherwise resend with received payload
                if (msg.substr(24,4) != '0000') {
                    temp = Buffer.from(p_fullsync);
                    temp[12] = d[12];
                    temp[13] = d[13];
                    global.inncom_client.write(temp); 
                    console.log('next sync requested');
                }
                else
                    console.log('sync end');
            }
            // point update - if update event, process
            if (p_type == 'a0') {
                console.log('event');
                process_update(Buffer.from(d));
            }
            // point report - if report event, process
            if (p_type == '81') {
                console.log('report');
                process_report(Buffer.from(d));
            }
        });
        // reopen conenction if error closes it
        global.inncom_client.on('error', function(d) {
			global.inncom_client = s.connect(INNCOM_PORT, INNCOM_IP, function() {
				console.log('client re-connected');
			});
		});
    }
    catch(e) {
        console.log('Connect error:',e);
    }
	
	// also create socket server to listen for bacnet writes
	try {
		if (typeof global.inncom_socket === 'undefined') {
			global.inncom_socket = s.createServer((socket) => {
				socket.on('data', (data) => {
					global.inncom_client.write(data);
					console.log(`Socket write: ${data.toString('hex')}`);
					console.log(data);
				});
				socket.on('connection', () => {
					console.log('socket connection');
				});
				socket.on('end', () => {
					console.log('sicket disconnected');
				});
			});
			global.inncom_socket.listen(INNCOM_SOCKET, () => {
				console.log('socket listening');
			}); 
		}
    }
    catch(e) {
        console.log('Socket server error:',e);
    }
	
};

// process point report - there may be multiple packets in the message
// typical format: ff 81 00 09 00 00 00 00 00 00 00 00 00 c9 02 10 10 02 d0 00 0e
async function process_report(d) {
    try {
        // grab packet as string
        var msg = d.toString('hex');
        // grab packet length (the packet may contain multiple contiguous packets)
        var d_length = d.length;
        var p_start = 0;
        var p_length = 12 + (d[(p_start + 3)]);
		var m = '';
		var p_type = '';
		var room = 0;
		var p_code = '';
		var p_value = 0;
		var p_work = '';
		var p_unit = null;
        // for each actual packet
        while (d_length > p_start) {
            // grab individual packet
            m = msg.substr((p_start * 2),(p_length * 2));
            // grab packet type
            p_type = m.substr(2,2).toLowerCase();
            // grab room
            p_room = parseInt(m.substr(24,4), 16);
            // grab code
            p_code = m.substr(30,4).toLowerCase();
			// grab default value
			p_value = parseInt(m.substr(34,4), 16);
			// 95 = no-unit
			p_unit = 95;
            // if update event, process
			// types: 2=analog, 5=bool
			// value types: real,boolean
			// local object call is room number, point number (for write), name, type, unit and value
            if (p_type == '81') {
				console.log('report: ',m);
                switch (p_code) {
					case "000e":
						local_object(p_room,0,'Check Out',5,p_unit,p_value);
						break;
					case "000f":
						local_object(p_room,0,'Check In',5,p_unit,p_value);
						break;
					case "0030":
						local_object(p_room,0,'Ring Doorbell',5,p_unit,p_value);
						break;
					case "0039","1010":
						// get target temp
						p_work = (parseInt(m.substr(34,4),16).toString(2)).padStart(16, '0');
						p_value = parseInt(p_work.substr(4,12),2) / 10;
						// get unit 64=F while 62=C
						p_unit = 64;
						if (p_work.substr(0,1) == '1')
							p_unit = 62;
						if (p_work.substr(1,1) == '1')
							p_value = p_value * -1;
						local_object(p_room,63,'Target Temperature',2,p_unit,p_value);
						// get hvac mode
						p_work = (parseInt(m.substr(38,4),16).toString(2)).padStart(16, '0');
						// get fan speed
						p_value = parseInt(p_work.substr(12,2),2);
						p_unit = 95;
						local_object(p_room,66,'Fan Speed',2,p_unit,p_value);
						// get mode
						p_value = parseInt(p_work.substr(14,2),2);
						p_unit = 95;
						local_object(p_room,65,'Mode',2,p_unit,p_value);
						break;
					case "003a":
						// get display temp
						p_work = (parseInt(m.substr(34,4),16).toString(2)).padStart(16, '0');
						p_value = parseInt(p_work.substr(4,12),2) / 10;
						p_unit = 64;
						if (p_work.substr(0,1) == '1')
							p_unit = 62;
						if (p_work.substr(1,1) == '1')
							p_value = p_value * -1;
						local_object(p_room,0,'Display Temperature',2,p_unit,p_value);
						break;
					case "003b","0170":
						// get fan speed
						p_work = (parseInt(m.substr(34,4),16).toString(2)).padStart(16, '0');
						p_value = parseInt(p_work.substr(14,2),2);
						p_unit = 95;
						local_object(p_room,66,'Fan Speed',2,p_unit,p_value);
						break;
					case "1000":
						local_object(p_room,0,'Occupancy',5,p_unit,p_value);
						break;
					case "1004":
						local_object(p_room,0,'Rented',5,p_unit,p_value);
						break;
					case "1006":
						local_object(p_room,0,'Hibernation',5,p_unit,p_value);
						break;
					case "1008":
						local_object(p_room,32,'DND',5,p_unit,p_value);
						break;
					case "100a":
						local_object(p_room,33,'MUR',5,p_unit,p_value);
						break;
					case "100c":
						local_object(p_room,0,'Minibar Door',5,p_unit,p_value);
						break;
					case "100e":
						local_object(p_room,0,'Minibar Used',5,p_unit,p_value);
						break;
					case "101c":
						local_object(p_room,0,'EMS',5,p_unit,p_value);
						break;
					case "101d":
						local_object(p_room,0,'Automation',5,p_unit,p_value);
						break;
					case "101e":
						local_object(p_room,0,'ADA',5,p_unit,p_value);
						break;
					case "1020":
						local_object(p_room,0,'Humidity',2,p_unit,p_value);
						break;
					case "1034":
						local_object(p_room,0,'Peak Demand',2,p_unit,p_value);
						break;
					case "1037":
						local_object(p_room,0,'Wet',5,p_unit,p_value);
						break;
					case "1090":
						local_object(p_room,0,'Light Level',2,p_unit,p_value);
						break;
					case "10d0":
						local_object(p_room,0,'Room Dirty',5,p_unit,p_value);
						break;
					case "10d1":
						local_object(p_room,0,'Supervisor',5,p_unit,p_value);
						break;
					case "10d2":
						local_object(p_room,0,'Out of Order',5,p_unit,p_value);
						break;
					case "10d3":
						local_object(p_room,0,'VIP',5,p_unit,p_value);
						break;
					case "10d4":
						local_object(p_room,176,'ECO Mode',5,p_unit,p_value);
						break;
					case "10d8":
						// get outside temp
						p_work = (parseInt(m.substr(34,4),16).toString(2)).padStart(16, '0');
						p_value = parseInt(p_work.substr(4,12),2) / 10;
						// get unit 64=F while 62=C
						p_unit = 64;
						if (p_work.substr(0,1) == '1')
							p_unit = 62;
						if (p_work.substr(1,1) == '1')
							p_value = p_value * -1;
						local_object(p_room,0,'Outside Temperature',2,p_unit,p_value);
						break;
					case "10e2":
						local_object(p_room,154,'Valet',5,p_unit,p_value);
						break;
					case "10e3":
						local_object(p_room,155,'Foodtray',5,p_unit,p_value);
						break;
					case "10e4":
						local_object(p_room,156,'Butler',5,p_unit,p_value);
						break;
					case "10e5":
						local_object(p_room,0,'Shoeshine',5,p_unit,p_value);
						break;
					case "10e6":
						local_object(p_room,0,'Msg Waiting',5,p_unit,p_value);
						break;
					case "10e7":
						local_object(p_room,0,'SOS',5,p_unit,p_value);
						break;
					case "10e8":
						local_object(p_room,0,'Safe Locked',5,p_unit,p_value);
						break;
					case "10ea":
						local_object(p_room,0,'Smoke Alarm',5,p_unit,p_value);
						break;
					case "10eb":
						local_object(p_room,0,'Key Tag',5,p_unit,p_value);
						break;
					case "10ec":
						local_object(p_room,0,'Window Open',5,p_unit,p_value);
						break;
					case "10ed":
						local_object(p_room,0,'Phone In Use',5,p_unit,p_value);
						break;
					case "10ee":
						local_object(p_room,0,'Entry Door Open',5,p_unit,p_value);
						break;
				}
            }
            // increment packet pointer
            p_start = p_start + p_length;
            if (p_start < d_length) {
                p_length = 12 + (d[(p_start + 3)]);
            }
        }
    }
    catch(e) {
        console.log('Report error:',e);
    }
}

// process point change - there may be multiple packets in the message
// these are received when changes take place or on full sync requests
// typical format: ff a0 00 17 00 01 00 00 00 00 00 00 00 c9 03 e0 10 20 0a 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01 00
async function process_update(d) {
    try {
        // grab packet as string
        var msg = d.toString('hex');
        // grab packet length (the packet may contain multiple contiguous packets)
        var d_length = d.length;
        var p_start = 0;
        var p_length = 12 + (d[(p_start + 3)]);
		var m = '';
		var p_type = '';
		var room = 0;
		var p_code = '';
		var p_value = 0;
		var p_work = '';
		var p_unit = null;
        // for each actual packet
        while (d_length > p_start) {
            // grab individual packet
            m = msg.substr((p_start * 2),(p_length * 2));
            // grab packet type
            p_type = m.substr(2,2).toLowerCase();
            // grab room
            p_room = parseInt(m.substr(24,4), 16);
            // grab code
            p_code = m.substr(30,4).toLowerCase();
			// grab default value
			p_value = parseInt(m.substr(34,4), 16);
			// 95 = no-unit
			p_unit = 95;
            // if update event, process
			// types: 2=analog, 5=bool
			// value types: real,boolean
            if (p_type == 'a0') {
				console.log('update: ',m);
                switch (p_code) {
					case "e000":
						local_object(p_room,0,'Rented',5,p_unit,p_value);
						break;
					case "e001":
						local_object(p_room,0,'Occupancy',5,p_unit,p_value);
						break;
					case "e002":
						local_object(p_room,32,'DND',5,p_unit,p_value);
						break;
					case "e003":
						local_object(p_room,33,'MUR',5,p_unit,p_value);
						break;
					case "e004":
						local_object(p_room,156,'Butler',5,p_unit,p_value);
						break;
					case "e005":
						local_object(p_room,155,'Foodtray',5,p_unit,p_value);
						break;
					case "e006":
						local_object(p_room,0,'Safe Locked',5,p_unit,p_value);
						break;
					case "e007":
						local_object(p_room,154,'Valet',5,p_unit,p_value);
						break;
					case "e008":
						local_object(p_room,0,'Comfort Status',5,p_unit,p_value);
						break;
					case "e009":
						local_object(p_room,0,'HVAC Status',5,p_unit,p_value);
						break;
					case "e00a":
						local_object(p_room,0,'Door Ajar',5,p_unit,p_value);
						break;
					case "e00b":
						local_object(p_room,0,'Door Open',5,p_unit,p_value);
						break;
					case "e010":
						// target temp, fs, mode
						p_work = (parseInt(m.substr(34,4),16).toString(2)).padStart(16, '0');
						// get target temp (as value - 40)
						p_value = parseInt(p_work.substr(2,6),2) + 40;
						// get unit 64=F while 62=C
						p_unit = 64;
						if (p_work.substr(1,1) == '1')
							p_unit = 62;
						local_object(p_room,63,'Target Temperature',2,p_unit,p_value);
						// get fan speed
						p_value = parseInt(p_work.substr(12,2),2);
						p_unit = 95;
						local_object(p_room,66,'Fan Speed',2,p_unit,p_value);
						// get mode
						p_value = parseInt(p_work.substr(14,2),2);
						p_unit = 95;
						local_object(p_room,65,'Mode',2,p_unit,p_value);
						break;
					case "e011":
						local_object(p_room,0,'Aux1',5,p_unit,p_value);
						break;
					case "e012":
						local_object(p_room,0,'Aux2',5,p_unit,p_value);
						break;
					case "e013":
						local_object(p_room,0,'Room Dirty',5,p_unit,p_value);
						break;
					case "e014":
						local_object(p_room,0,'Supervisor',5,p_unit,p_value);
						break;
					case "e015":
						local_object(p_room,0,'Out of Order',5,p_unit,p_value);
						break;
					case "e016":
						local_object(p_room,0,'Smoke Detector',5,p_unit,p_value);
						break;
					case "e017":
						local_object(p_room,0,'Air Filter',5,p_unit,p_value);
						break;
				}
			}
			// increment packet pointer
			p_start = p_start + p_length;
			if (p_start < d_length) {
				p_length = 12 + (d[(p_start + 3)]);
			}
		}
    }
    catch(e) {
        console.log('Update error:',e);
    }
}

async function local_object(room,code,name,type,unit,pvalue) {
    // enum https://reference.opcfoundation.org/BACnet/v200/docs/11
	// vtype https://biancoroyal.github.io/node-bacstack/global.html#ApplicationTag
    const NEURO_NAMESPACE = '21e829e8-b08d-412f-b196-39f0ec3e691a';
    const NEURO_EQUIP_TYPE = 'd0e313a3-fce4-4665-96cc-3d34ad53ede0';
	var dname = name.replaceAll(' ','').toLowerCase();
	var props = [];
	
	// debug test
	console.log('object: ',room,name,type,unit,pvalue);
	//return;
	
	// push value type
	if (type == 2) 
		props.push({property: "PROP_PRESENT_VALUE", value: {real: pvalue}});
	else
		props.push({property: "PROP_PRESENT_VALUE", value: {enumerated: pvalue}});
		
	// try update first via patch
	await http.patch("/api/v1/bacnet/local", {
		uuid: uuidv5(room + "." + dname, NEURO_NAMESPACE),
		props: props
	}).catch((e) => {
		// if not found, try create via post (room and code require 1000 offset to play nice with bacnet enums)
		if (e.status === 404) {
			props.push(
				{property: 1000, value: {real: room}},
				{property: 1001, value: {real: code}},
				{property: "PROP_UNITS", value: {enumerated: unit}},
				{property: "PROP_OBJECT_NAME", value: {characterString: "Room " + room + " " + name}},
				{property: "PROP_DESCRIPTION", value: {characterString: name + " Sensor"}});
			http.post("/api/v1/bacnet/local", {
				uuid: uuidv5(room + "." + dname, NEURO_NAMESPACE),
				objectId: {instance: 0, objectType: type},
				props: props
			}).catch((e) => {
				return;
			});
		}
	});
}
