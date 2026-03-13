{
	"patcher": {
		"fileversion": 1,
		"appversion": {
			"major": 9,
			"minor": 0,
			"revision": 5,
			"architecture": "x64",
			"modernui": 1
		},
		"classnamespace": "box",
		"rect": [
			0.0,
			0.0,
			800.0,
			340.0
		],
		"gridsize": [
			15.0,
			15.0
		],
		"boxes": [
			{
				"box": {
					"id": "obj-1",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						10.0,
						8.0,
						500.0,
						19.0
					],
					"text": "sensor-mapping.maxpat \u2014 mubone IMU \u2192 granular synth mapping engine",
					"fontface": 1,
					"fontsize": 14.0
				}
			},
			{
				"box": {
					"id": "obj-2",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						10.0,
						32.0,
						350.0,
						19.0
					],
					"text": "WebSocket output: s osc-hub  (bridge.js \u2192 browser)"
				}
			},
			{
				"box": {
					"id": "obj-3",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						10.0,
						50.0,
						350.0,
						19.0
					],
					"text": "Sensor input buses: s data_A / s data_B / s data_C"
				}
			},
			{
				"box": {
					"id": "obj-4",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						10.0,
						68.0,
						450.0,
						19.0
					],
					"text": "All mapping slot parameters captured by p presets / pattrstorage"
				}
			},
			{
				"box": {
					"id": "obj-659",
					"maxclass": "newobj",
					"numinlets": 0,
					"numoutlets": 0,
					"outlettype": [],
					"patching_rect": [
						10.0,
						100.0,
						130,
						22.0
					],
					"text": "p sensor_inputs",
					"patcher": {
						"fileversion": 1,
						"appversion": {
							"major": 9,
							"minor": 0,
							"revision": 5,
							"architecture": "x64",
							"modernui": 1
						},
						"classnamespace": "box",
						"rect": [
							0.0,
							0.0,
							1450.0,
							440.0
						],
						"gridsize": [
							15.0,
							15.0
						],
						"boxes": [
							{
								"box": {
									"id": "obj-5",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										8.0,
										450.0,
										19.0
									],
									"text": "p sensor_inputs \u2014 receive and type-convert raw IMU data",
									"fontface": 1,
									"fontsize": 12.0
								}
							},
							{
								"box": {
									"id": "obj-6",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										26.0,
										500.0,
										19.0
									],
									"text": "Each sensor receives from  r data_A / data_B / data_C"
								}
							},
							{
								"box": {
									"id": "obj-7",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										44.0,
										550.0,
										19.0
									],
									"text": "Wire your bno085 or x-IMU3 instances to  s data_A / s data_B / s data_C"
								}
							},
							{
								"box": {
									"id": "obj-8",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										75.0,
										250.0,
										19.0
									],
									"text": "=== SENSOR A  (instrument) ===",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-9",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										97.0,
										160.0,
										19.0
									],
									"text": "0 = BNO085   1 = x-IMU3"
								}
							},
							{
								"box": {
									"id": "obj-10",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										10.0,
										115.0,
										24.0,
										24.0
									],
									"varname": "sensortype_A"
								}
							},
							{
								"box": {
									"id": "obj-11",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										38.0,
										118.0,
										60.0,
										19.0
									],
									"text": "type A"
								}
							},
							{
								"box": {
									"id": "obj-12",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"bang",
										"bang"
									],
									"patching_rect": [
										70.0,
										115.0,
										50.0,
										22.0
									],
									"text": "sel 0 1"
								}
							},
							{
								"box": {
									"id": "obj-13",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										70.0,
										141.0,
										35.0,
										22.0
									],
									"text": "1.0"
								}
							},
							{
								"box": {
									"id": "obj-14",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										110.0,
										141.0,
										55.0,
										22.0
									],
									"text": "0.01745"
								}
							},
							{
								"box": {
									"id": "obj-15",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										70.0,
										167.0,
										65.0,
										22.0
									],
									"text": "float 1.0"
								}
							},
							{
								"box": {
									"id": "obj-16",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										150.0,
										141.0,
										35.0,
										22.0
									],
									"text": "1.0"
								}
							},
							{
								"box": {
									"id": "obj-17",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										190.0,
										141.0,
										45.0,
										22.0
									],
									"text": "9.81"
								}
							},
							{
								"box": {
									"id": "obj-18",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										150.0,
										167.0,
										65.0,
										22.0
									],
									"text": "float 1.0"
								}
							},
							{
								"box": {
									"id": "obj-19",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										205.0,
										70.0,
										22.0
									],
									"text": "r data_A"
								}
							},
							{
								"box": {
									"id": "obj-20",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 5,
									"outlettype": [
										"",
										"",
										"",
										"",
										""
									],
									"patching_rect": [
										10.0,
										231.0,
										340.0,
										22.0
									],
									"text": "route angular_rate orientation acceleration direction azimuth"
								}
							},
							{
								"box": {
									"id": "obj-21",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										10.0,
										257.0,
										80.0,
										22.0
									],
									"text": "unpack f f f"
								}
							},
							{
								"box": {
									"id": "obj-22",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-23",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										115.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-24",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										220.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-25",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										309.0,
										70.0,
										22.0
									],
									"text": "pack f f f"
								}
							},
							{
								"box": {
									"id": "obj-26",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										10.0,
										335.0,
										100.0,
										22.0
									],
									"text": "s sm_A_angrate"
								}
							},
							{
								"box": {
									"id": "obj-27",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										10.0,
										361.0,
										100.0,
										22.0
									],
									"text": "s sm_A_angx"
								}
							},
							{
								"box": {
									"id": "obj-28",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										115.0,
										361.0,
										100.0,
										22.0
									],
									"text": "s sm_A_angy"
								}
							},
							{
								"box": {
									"id": "obj-29",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										220.0,
										361.0,
										100.0,
										22.0
									],
									"text": "s sm_A_angz"
								}
							},
							{
								"box": {
									"id": "obj-30",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										355.0,
										231.0,
										30.0,
										22.0
									],
									"text": "+ 1"
								}
							},
							{
								"box": {
									"id": "obj-31",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 2,
									"outlettype": [
										"",
										""
									],
									"patching_rect": [
										355.0,
										257.0,
										50.0,
										22.0
									],
									"text": "gate 2"
								}
							},
							{
								"box": {
									"id": "obj-32",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"float",
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										355.0,
										283.0,
										95.0,
										22.0
									],
									"text": "unpack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-33",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										355.0,
										309.0,
										80.0,
										22.0
									],
									"text": "pack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-34",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"float",
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										455.0,
										283.0,
										95.0,
										22.0
									],
									"text": "unpack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-35",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										455.0,
										309.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-36",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										495.0,
										309.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-37",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										535.0,
										309.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-38",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										455.0,
										361.0,
										90.0,
										22.0
									],
									"text": "pak 0. 0. 0. 0."
								}
							},
							{
								"box": {
									"id": "obj-39",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"bang",
										"float"
									],
									"patching_rect": [
										455.0,
										335.0,
										40.0,
										22.0
									],
									"text": "t b f"
								}
							},
							{
								"box": {
									"id": "obj-40",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										355.0,
										387.0,
										90.0,
										22.0
									],
									"text": "s sm_A_quat"
								}
							},
							{
								"box": {
									"id": "obj-41",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										580.0,
										257.0,
										80.0,
										22.0
									],
									"text": "unpack f f f"
								}
							},
							{
								"box": {
									"id": "obj-42",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										580.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-43",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										685.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-44",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										790.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-45",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										580.0,
										309.0,
										70.0,
										22.0
									],
									"text": "pack f f f"
								}
							},
							{
								"box": {
									"id": "obj-46",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										580.0,
										335.0,
										100.0,
										22.0
									],
									"text": "s sm_A_accel"
								}
							},
							{
								"box": {
									"id": "obj-47",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										900.0,
										257.0,
										80.0,
										22.0
									],
									"text": "unpack f f f"
								}
							},
							{
								"box": {
									"id": "obj-48",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										900.0,
										283.0,
										100.0,
										22.0
									],
									"text": "s sm_A_dirx"
								}
							},
							{
								"box": {
									"id": "obj-49",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1010.0,
										283.0,
										100.0,
										22.0
									],
									"text": "s sm_A_diry"
								}
							},
							{
								"box": {
									"id": "obj-50",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1115.0,
										283.0,
										100.0,
										22.0
									],
									"text": "s sm_A_dirz"
								}
							},
							{
								"box": {
									"id": "obj-51",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1125.0,
										257.0,
										80.0,
										22.0
									],
									"text": "s sm_A_az"
								}
							},
							{
								"box": {
									"id": "obj-52",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										490.0,
										75.0,
										250.0,
										19.0
									],
									"text": "=== SENSOR B  (body) ===",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-53",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										490.0,
										97.0,
										160.0,
										19.0
									],
									"text": "0 = BNO085   1 = x-IMU3"
								}
							},
							{
								"box": {
									"id": "obj-54",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										490.0,
										115.0,
										24.0,
										24.0
									],
									"varname": "sensortype_B"
								}
							},
							{
								"box": {
									"id": "obj-55",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										518.0,
										118.0,
										60.0,
										19.0
									],
									"text": "type B"
								}
							},
							{
								"box": {
									"id": "obj-56",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"bang",
										"bang"
									],
									"patching_rect": [
										550.0,
										115.0,
										50.0,
										22.0
									],
									"text": "sel 0 1"
								}
							},
							{
								"box": {
									"id": "obj-57",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										550.0,
										141.0,
										35.0,
										22.0
									],
									"text": "1.0"
								}
							},
							{
								"box": {
									"id": "obj-58",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										590.0,
										141.0,
										55.0,
										22.0
									],
									"text": "0.01745"
								}
							},
							{
								"box": {
									"id": "obj-59",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										550.0,
										167.0,
										65.0,
										22.0
									],
									"text": "float 1.0"
								}
							},
							{
								"box": {
									"id": "obj-60",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										630.0,
										141.0,
										35.0,
										22.0
									],
									"text": "1.0"
								}
							},
							{
								"box": {
									"id": "obj-61",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										670.0,
										141.0,
										45.0,
										22.0
									],
									"text": "9.81"
								}
							},
							{
								"box": {
									"id": "obj-62",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										630.0,
										167.0,
										65.0,
										22.0
									],
									"text": "float 1.0"
								}
							},
							{
								"box": {
									"id": "obj-63",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										490.0,
										205.0,
										70.0,
										22.0
									],
									"text": "r data_B"
								}
							},
							{
								"box": {
									"id": "obj-64",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 5,
									"outlettype": [
										"",
										"",
										"",
										"",
										""
									],
									"patching_rect": [
										490.0,
										231.0,
										340.0,
										22.0
									],
									"text": "route angular_rate orientation acceleration direction azimuth"
								}
							},
							{
								"box": {
									"id": "obj-65",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										490.0,
										257.0,
										80.0,
										22.0
									],
									"text": "unpack f f f"
								}
							},
							{
								"box": {
									"id": "obj-66",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										490.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-67",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										595.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-68",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										700.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-69",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										490.0,
										309.0,
										70.0,
										22.0
									],
									"text": "pack f f f"
								}
							},
							{
								"box": {
									"id": "obj-70",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										490.0,
										335.0,
										100.0,
										22.0
									],
									"text": "s sm_B_angrate"
								}
							},
							{
								"box": {
									"id": "obj-71",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										490.0,
										361.0,
										100.0,
										22.0
									],
									"text": "s sm_B_angx"
								}
							},
							{
								"box": {
									"id": "obj-72",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										595.0,
										361.0,
										100.0,
										22.0
									],
									"text": "s sm_B_angy"
								}
							},
							{
								"box": {
									"id": "obj-73",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										700.0,
										361.0,
										100.0,
										22.0
									],
									"text": "s sm_B_angz"
								}
							},
							{
								"box": {
									"id": "obj-74",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										835.0,
										231.0,
										30.0,
										22.0
									],
									"text": "+ 1"
								}
							},
							{
								"box": {
									"id": "obj-75",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 2,
									"outlettype": [
										"",
										""
									],
									"patching_rect": [
										835.0,
										257.0,
										50.0,
										22.0
									],
									"text": "gate 2"
								}
							},
							{
								"box": {
									"id": "obj-76",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"float",
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										835.0,
										283.0,
										95.0,
										22.0
									],
									"text": "unpack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-77",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										835.0,
										309.0,
										80.0,
										22.0
									],
									"text": "pack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-78",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"float",
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										935.0,
										283.0,
										95.0,
										22.0
									],
									"text": "unpack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-79",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										935.0,
										309.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-80",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										975.0,
										309.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-81",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1015.0,
										309.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-82",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										935.0,
										361.0,
										90.0,
										22.0
									],
									"text": "pak 0. 0. 0. 0."
								}
							},
							{
								"box": {
									"id": "obj-83",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"bang",
										"float"
									],
									"patching_rect": [
										935.0,
										335.0,
										40.0,
										22.0
									],
									"text": "t b f"
								}
							},
							{
								"box": {
									"id": "obj-84",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										835.0,
										387.0,
										90.0,
										22.0
									],
									"text": "s sm_B_quat"
								}
							},
							{
								"box": {
									"id": "obj-85",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										1060.0,
										257.0,
										80.0,
										22.0
									],
									"text": "unpack f f f"
								}
							},
							{
								"box": {
									"id": "obj-86",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1060.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-87",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1165.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-88",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1270.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-89",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1060.0,
										309.0,
										70.0,
										22.0
									],
									"text": "pack f f f"
								}
							},
							{
								"box": {
									"id": "obj-90",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1060.0,
										335.0,
										100.0,
										22.0
									],
									"text": "s sm_B_accel"
								}
							},
							{
								"box": {
									"id": "obj-91",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										1380.0,
										257.0,
										80.0,
										22.0
									],
									"text": "unpack f f f"
								}
							},
							{
								"box": {
									"id": "obj-92",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1380.0,
										283.0,
										100.0,
										22.0
									],
									"text": "s sm_B_dirx"
								}
							},
							{
								"box": {
									"id": "obj-93",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1490.0,
										283.0,
										100.0,
										22.0
									],
									"text": "s sm_B_diry"
								}
							},
							{
								"box": {
									"id": "obj-94",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1595.0,
										283.0,
										100.0,
										22.0
									],
									"text": "s sm_B_dirz"
								}
							},
							{
								"box": {
									"id": "obj-95",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1605.0,
										257.0,
										80.0,
										22.0
									],
									"text": "s sm_B_az"
								}
							},
							{
								"box": {
									"id": "obj-96",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										970.0,
										75.0,
										250.0,
										19.0
									],
									"text": "=== SENSOR C  (floor / world) ===",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-97",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										970.0,
										97.0,
										160.0,
										19.0
									],
									"text": "0 = BNO085   1 = x-IMU3"
								}
							},
							{
								"box": {
									"id": "obj-98",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										970.0,
										115.0,
										24.0,
										24.0
									],
									"varname": "sensortype_C"
								}
							},
							{
								"box": {
									"id": "obj-99",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										998.0,
										118.0,
										60.0,
										19.0
									],
									"text": "type C"
								}
							},
							{
								"box": {
									"id": "obj-100",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"bang",
										"bang"
									],
									"patching_rect": [
										1030.0,
										115.0,
										50.0,
										22.0
									],
									"text": "sel 0 1"
								}
							},
							{
								"box": {
									"id": "obj-101",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1030.0,
										141.0,
										35.0,
										22.0
									],
									"text": "1.0"
								}
							},
							{
								"box": {
									"id": "obj-102",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1070.0,
										141.0,
										55.0,
										22.0
									],
									"text": "0.01745"
								}
							},
							{
								"box": {
									"id": "obj-103",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1030.0,
										167.0,
										65.0,
										22.0
									],
									"text": "float 1.0"
								}
							},
							{
								"box": {
									"id": "obj-104",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1110.0,
										141.0,
										35.0,
										22.0
									],
									"text": "1.0"
								}
							},
							{
								"box": {
									"id": "obj-105",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1150.0,
										141.0,
										45.0,
										22.0
									],
									"text": "9.81"
								}
							},
							{
								"box": {
									"id": "obj-106",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1110.0,
										167.0,
										65.0,
										22.0
									],
									"text": "float 1.0"
								}
							},
							{
								"box": {
									"id": "obj-107",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										970.0,
										205.0,
										70.0,
										22.0
									],
									"text": "r data_C"
								}
							},
							{
								"box": {
									"id": "obj-108",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 5,
									"outlettype": [
										"",
										"",
										"",
										"",
										""
									],
									"patching_rect": [
										970.0,
										231.0,
										340.0,
										22.0
									],
									"text": "route angular_rate orientation acceleration direction azimuth"
								}
							},
							{
								"box": {
									"id": "obj-109",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										970.0,
										257.0,
										80.0,
										22.0
									],
									"text": "unpack f f f"
								}
							},
							{
								"box": {
									"id": "obj-110",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										970.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-111",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1075.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-112",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1180.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-113",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										970.0,
										309.0,
										70.0,
										22.0
									],
									"text": "pack f f f"
								}
							},
							{
								"box": {
									"id": "obj-114",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										970.0,
										335.0,
										100.0,
										22.0
									],
									"text": "s sm_C_angrate"
								}
							},
							{
								"box": {
									"id": "obj-115",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										970.0,
										361.0,
										100.0,
										22.0
									],
									"text": "s sm_C_angx"
								}
							},
							{
								"box": {
									"id": "obj-116",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1075.0,
										361.0,
										100.0,
										22.0
									],
									"text": "s sm_C_angy"
								}
							},
							{
								"box": {
									"id": "obj-117",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1180.0,
										361.0,
										100.0,
										22.0
									],
									"text": "s sm_C_angz"
								}
							},
							{
								"box": {
									"id": "obj-118",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1315.0,
										231.0,
										30.0,
										22.0
									],
									"text": "+ 1"
								}
							},
							{
								"box": {
									"id": "obj-119",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 2,
									"outlettype": [
										"",
										""
									],
									"patching_rect": [
										1315.0,
										257.0,
										50.0,
										22.0
									],
									"text": "gate 2"
								}
							},
							{
								"box": {
									"id": "obj-120",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"float",
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										1315.0,
										283.0,
										95.0,
										22.0
									],
									"text": "unpack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-121",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1315.0,
										309.0,
										80.0,
										22.0
									],
									"text": "pack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-122",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"float",
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										1415.0,
										283.0,
										95.0,
										22.0
									],
									"text": "unpack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-123",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1415.0,
										309.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-124",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1455.0,
										309.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-125",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1495.0,
										309.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-126",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1415.0,
										361.0,
										90.0,
										22.0
									],
									"text": "pak 0. 0. 0. 0."
								}
							},
							{
								"box": {
									"id": "obj-127",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"bang",
										"float"
									],
									"patching_rect": [
										1415.0,
										335.0,
										40.0,
										22.0
									],
									"text": "t b f"
								}
							},
							{
								"box": {
									"id": "obj-128",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1315.0,
										387.0,
										90.0,
										22.0
									],
									"text": "s sm_C_quat"
								}
							},
							{
								"box": {
									"id": "obj-129",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										1540.0,
										257.0,
										80.0,
										22.0
									],
									"text": "unpack f f f"
								}
							},
							{
								"box": {
									"id": "obj-130",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1540.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-131",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1645.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-132",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1750.0,
										283.0,
										100.0,
										22.0
									],
									"text": "expr $f1 * $f2"
								}
							},
							{
								"box": {
									"id": "obj-133",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1540.0,
										309.0,
										70.0,
										22.0
									],
									"text": "pack f f f"
								}
							},
							{
								"box": {
									"id": "obj-134",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1540.0,
										335.0,
										100.0,
										22.0
									],
									"text": "s sm_C_accel"
								}
							},
							{
								"box": {
									"id": "obj-135",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										1860.0,
										257.0,
										80.0,
										22.0
									],
									"text": "unpack f f f"
								}
							},
							{
								"box": {
									"id": "obj-136",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1860.0,
										283.0,
										100.0,
										22.0
									],
									"text": "s sm_C_dirx"
								}
							},
							{
								"box": {
									"id": "obj-137",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1970.0,
										283.0,
										100.0,
										22.0
									],
									"text": "s sm_C_diry"
								}
							},
							{
								"box": {
									"id": "obj-138",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										2075.0,
										283.0,
										100.0,
										22.0
									],
									"text": "s sm_C_dirz"
								}
							},
							{
								"box": {
									"id": "obj-139",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										2085.0,
										257.0,
										80.0,
										22.0
									],
									"text": "s sm_C_az"
								}
							}
						],
						"lines": [
							{
								"patchline": {
									"source": [
										"obj-10",
										0
									],
									"destination": [
										"obj-12",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-12",
										0
									],
									"destination": [
										"obj-13",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-12",
										1
									],
									"destination": [
										"obj-14",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-13",
										0
									],
									"destination": [
										"obj-15",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-14",
										0
									],
									"destination": [
										"obj-15",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-12",
										0
									],
									"destination": [
										"obj-16",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-12",
										1
									],
									"destination": [
										"obj-17",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-16",
										0
									],
									"destination": [
										"obj-18",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-17",
										0
									],
									"destination": [
										"obj-18",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-19",
										0
									],
									"destination": [
										"obj-20",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-20",
										0
									],
									"destination": [
										"obj-21",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-21",
										0
									],
									"destination": [
										"obj-22",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-21",
										1
									],
									"destination": [
										"obj-23",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-21",
										2
									],
									"destination": [
										"obj-24",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-15",
										0
									],
									"destination": [
										"obj-22",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-15",
										0
									],
									"destination": [
										"obj-23",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-15",
										0
									],
									"destination": [
										"obj-24",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-22",
										0
									],
									"destination": [
										"obj-25",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-23",
										0
									],
									"destination": [
										"obj-25",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-24",
										0
									],
									"destination": [
										"obj-25",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-25",
										0
									],
									"destination": [
										"obj-26",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-22",
										0
									],
									"destination": [
										"obj-27",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-23",
										0
									],
									"destination": [
										"obj-28",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-24",
										0
									],
									"destination": [
										"obj-29",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-10",
										0
									],
									"destination": [
										"obj-30",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-30",
										0
									],
									"destination": [
										"obj-31",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-20",
										1
									],
									"destination": [
										"obj-31",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-31",
										0
									],
									"destination": [
										"obj-32",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-32",
										0
									],
									"destination": [
										"obj-33",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-32",
										1
									],
									"destination": [
										"obj-33",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-32",
										2
									],
									"destination": [
										"obj-33",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-32",
										3
									],
									"destination": [
										"obj-33",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-31",
										1
									],
									"destination": [
										"obj-34",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-34",
										1
									],
									"destination": [
										"obj-35",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-34",
										2
									],
									"destination": [
										"obj-36",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-34",
										3
									],
									"destination": [
										"obj-37",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-34",
										0
									],
									"destination": [
										"obj-39",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-39",
										1
									],
									"destination": [
										"obj-38",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-39",
										0
									],
									"destination": [
										"obj-35",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-35",
										0
									],
									"destination": [
										"obj-38",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-36",
										0
									],
									"destination": [
										"obj-38",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-37",
										0
									],
									"destination": [
										"obj-38",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-33",
										0
									],
									"destination": [
										"obj-40",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-38",
										0
									],
									"destination": [
										"obj-40",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-20",
										2
									],
									"destination": [
										"obj-41",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-41",
										0
									],
									"destination": [
										"obj-42",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-41",
										1
									],
									"destination": [
										"obj-43",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-41",
										2
									],
									"destination": [
										"obj-44",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-18",
										0
									],
									"destination": [
										"obj-42",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-18",
										0
									],
									"destination": [
										"obj-43",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-18",
										0
									],
									"destination": [
										"obj-44",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-42",
										0
									],
									"destination": [
										"obj-45",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-43",
										0
									],
									"destination": [
										"obj-45",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-44",
										0
									],
									"destination": [
										"obj-45",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-45",
										0
									],
									"destination": [
										"obj-46",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-20",
										3
									],
									"destination": [
										"obj-47",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-47",
										0
									],
									"destination": [
										"obj-48",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-47",
										1
									],
									"destination": [
										"obj-49",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-47",
										2
									],
									"destination": [
										"obj-50",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-20",
										4
									],
									"destination": [
										"obj-51",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-54",
										0
									],
									"destination": [
										"obj-56",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-56",
										0
									],
									"destination": [
										"obj-57",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-56",
										1
									],
									"destination": [
										"obj-58",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-57",
										0
									],
									"destination": [
										"obj-59",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-58",
										0
									],
									"destination": [
										"obj-59",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-56",
										0
									],
									"destination": [
										"obj-60",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-56",
										1
									],
									"destination": [
										"obj-61",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-60",
										0
									],
									"destination": [
										"obj-62",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-61",
										0
									],
									"destination": [
										"obj-62",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-63",
										0
									],
									"destination": [
										"obj-64",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-64",
										0
									],
									"destination": [
										"obj-65",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-65",
										0
									],
									"destination": [
										"obj-66",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-65",
										1
									],
									"destination": [
										"obj-67",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-65",
										2
									],
									"destination": [
										"obj-68",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-59",
										0
									],
									"destination": [
										"obj-66",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-59",
										0
									],
									"destination": [
										"obj-67",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-59",
										0
									],
									"destination": [
										"obj-68",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-66",
										0
									],
									"destination": [
										"obj-69",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-67",
										0
									],
									"destination": [
										"obj-69",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-68",
										0
									],
									"destination": [
										"obj-69",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-69",
										0
									],
									"destination": [
										"obj-70",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-66",
										0
									],
									"destination": [
										"obj-71",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-67",
										0
									],
									"destination": [
										"obj-72",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-68",
										0
									],
									"destination": [
										"obj-73",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-54",
										0
									],
									"destination": [
										"obj-74",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-74",
										0
									],
									"destination": [
										"obj-75",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-64",
										1
									],
									"destination": [
										"obj-75",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-75",
										0
									],
									"destination": [
										"obj-76",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-76",
										0
									],
									"destination": [
										"obj-77",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-76",
										1
									],
									"destination": [
										"obj-77",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-76",
										2
									],
									"destination": [
										"obj-77",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-76",
										3
									],
									"destination": [
										"obj-77",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-75",
										1
									],
									"destination": [
										"obj-78",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-78",
										1
									],
									"destination": [
										"obj-79",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-78",
										2
									],
									"destination": [
										"obj-80",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-78",
										3
									],
									"destination": [
										"obj-81",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-78",
										0
									],
									"destination": [
										"obj-83",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-83",
										1
									],
									"destination": [
										"obj-82",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-83",
										0
									],
									"destination": [
										"obj-79",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-79",
										0
									],
									"destination": [
										"obj-82",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-80",
										0
									],
									"destination": [
										"obj-82",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-81",
										0
									],
									"destination": [
										"obj-82",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-77",
										0
									],
									"destination": [
										"obj-84",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-82",
										0
									],
									"destination": [
										"obj-84",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-64",
										2
									],
									"destination": [
										"obj-85",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-85",
										0
									],
									"destination": [
										"obj-86",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-85",
										1
									],
									"destination": [
										"obj-87",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-85",
										2
									],
									"destination": [
										"obj-88",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-62",
										0
									],
									"destination": [
										"obj-86",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-62",
										0
									],
									"destination": [
										"obj-87",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-62",
										0
									],
									"destination": [
										"obj-88",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-86",
										0
									],
									"destination": [
										"obj-89",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-87",
										0
									],
									"destination": [
										"obj-89",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-88",
										0
									],
									"destination": [
										"obj-89",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-89",
										0
									],
									"destination": [
										"obj-90",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-64",
										3
									],
									"destination": [
										"obj-91",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-91",
										0
									],
									"destination": [
										"obj-92",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-91",
										1
									],
									"destination": [
										"obj-93",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-91",
										2
									],
									"destination": [
										"obj-94",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-64",
										4
									],
									"destination": [
										"obj-95",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-98",
										0
									],
									"destination": [
										"obj-100",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-100",
										0
									],
									"destination": [
										"obj-101",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-100",
										1
									],
									"destination": [
										"obj-102",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-101",
										0
									],
									"destination": [
										"obj-103",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-102",
										0
									],
									"destination": [
										"obj-103",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-100",
										0
									],
									"destination": [
										"obj-104",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-100",
										1
									],
									"destination": [
										"obj-105",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-104",
										0
									],
									"destination": [
										"obj-106",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-105",
										0
									],
									"destination": [
										"obj-106",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-107",
										0
									],
									"destination": [
										"obj-108",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-108",
										0
									],
									"destination": [
										"obj-109",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-109",
										0
									],
									"destination": [
										"obj-110",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-109",
										1
									],
									"destination": [
										"obj-111",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-109",
										2
									],
									"destination": [
										"obj-112",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-103",
										0
									],
									"destination": [
										"obj-110",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-103",
										0
									],
									"destination": [
										"obj-111",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-103",
										0
									],
									"destination": [
										"obj-112",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-110",
										0
									],
									"destination": [
										"obj-113",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-111",
										0
									],
									"destination": [
										"obj-113",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-112",
										0
									],
									"destination": [
										"obj-113",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-113",
										0
									],
									"destination": [
										"obj-114",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-110",
										0
									],
									"destination": [
										"obj-115",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-111",
										0
									],
									"destination": [
										"obj-116",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-112",
										0
									],
									"destination": [
										"obj-117",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-98",
										0
									],
									"destination": [
										"obj-118",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-118",
										0
									],
									"destination": [
										"obj-119",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-108",
										1
									],
									"destination": [
										"obj-119",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-119",
										0
									],
									"destination": [
										"obj-120",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-120",
										0
									],
									"destination": [
										"obj-121",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-120",
										1
									],
									"destination": [
										"obj-121",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-120",
										2
									],
									"destination": [
										"obj-121",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-120",
										3
									],
									"destination": [
										"obj-121",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-119",
										1
									],
									"destination": [
										"obj-122",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-122",
										1
									],
									"destination": [
										"obj-123",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-122",
										2
									],
									"destination": [
										"obj-124",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-122",
										3
									],
									"destination": [
										"obj-125",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-122",
										0
									],
									"destination": [
										"obj-127",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-127",
										1
									],
									"destination": [
										"obj-126",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-127",
										0
									],
									"destination": [
										"obj-123",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-123",
										0
									],
									"destination": [
										"obj-126",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-124",
										0
									],
									"destination": [
										"obj-126",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-125",
										0
									],
									"destination": [
										"obj-126",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-121",
										0
									],
									"destination": [
										"obj-128",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-126",
										0
									],
									"destination": [
										"obj-128",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-108",
										2
									],
									"destination": [
										"obj-129",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-129",
										0
									],
									"destination": [
										"obj-130",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-129",
										1
									],
									"destination": [
										"obj-131",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-129",
										2
									],
									"destination": [
										"obj-132",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-106",
										0
									],
									"destination": [
										"obj-130",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-106",
										0
									],
									"destination": [
										"obj-131",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-106",
										0
									],
									"destination": [
										"obj-132",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-130",
										0
									],
									"destination": [
										"obj-133",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-131",
										0
									],
									"destination": [
										"obj-133",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-132",
										0
									],
									"destination": [
										"obj-133",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-133",
										0
									],
									"destination": [
										"obj-134",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-108",
										3
									],
									"destination": [
										"obj-135",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-135",
										0
									],
									"destination": [
										"obj-136",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-135",
										1
									],
									"destination": [
										"obj-137",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-135",
										2
									],
									"destination": [
										"obj-138",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-108",
										4
									],
									"destination": [
										"obj-139",
										0
									]
								}
							}
						]
					}
				}
			},
			{
				"box": {
					"id": "obj-660",
					"maxclass": "newobj",
					"numinlets": 0,
					"numoutlets": 0,
					"outlettype": [],
					"patching_rect": [
						10.0,
						130.0,
						146,
						22.0
					],
					"text": "p derived_streams",
					"patcher": {
						"fileversion": 1,
						"appversion": {
							"major": 9,
							"minor": 0,
							"revision": 5,
							"architecture": "x64",
							"modernui": 1
						},
						"classnamespace": "box",
						"rect": [
							0.0,
							0.0,
							1450.0,
							550.0
						],
						"gridsize": [
							15.0,
							15.0
						],
						"boxes": [
							{
								"box": {
									"id": "obj-140",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										8.0,
										550.0,
										19.0
									],
									"text": "p derived_streams \u2014 magnitudes, jerk, stillness, relative orientation",
									"fontface": 1,
									"fontsize": 12.0
								}
							},
							{
								"box": {
									"id": "obj-141",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										40.0,
										180.0,
										19.0
									],
									"text": "\u2500\u2500 SENSOR A \u2500\u2500",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-142",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										62.0,
										110.0,
										22.0
									],
									"text": "r sm_A_angrate"
								}
							},
							{
								"box": {
									"id": "obj-143",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										10.0,
										88.0,
										80.0,
										22.0
									],
									"text": "unpack f f f"
								}
							},
							{
								"box": {
									"id": "obj-144",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										114.0,
										215.0,
										22.0
									],
									"text": "expr sqrt($f1*$f1 + $f2*$f2 + $f3*$f3)"
								}
							},
							{
								"box": {
									"id": "obj-145",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										10.0,
										140.0,
										110.0,
										22.0
									],
									"text": "s sm_A_angmag"
								}
							},
							{
								"box": {
									"id": "obj-146",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										235.0,
										62.0,
										110.0,
										22.0
									],
									"text": "r sm_A_accel"
								}
							},
							{
								"box": {
									"id": "obj-147",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										235.0,
										88.0,
										80.0,
										22.0
									],
									"text": "unpack f f f"
								}
							},
							{
								"box": {
									"id": "obj-148",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										235.0,
										114.0,
										215.0,
										22.0
									],
									"text": "expr sqrt($f1*$f1 + $f2*$f2 + $f3*$f3)"
								}
							},
							{
								"box": {
									"id": "obj-149",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										235.0,
										140.0,
										110.0,
										22.0
									],
									"text": "s sm_A_accmag"
								}
							},
							{
								"box": {
									"id": "obj-150",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"float",
										"float"
									],
									"patching_rect": [
										235.0,
										166.0,
										40.0,
										22.0
									],
									"text": "t f f"
								}
							},
							{
								"box": {
									"id": "obj-151",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										280.0,
										166.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-152",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										235.0,
										192.0,
										130.0,
										22.0
									],
									"text": "expr abs($f1 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-153",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										235.0,
										218.0,
										95.0,
										22.0
									],
									"text": "s sm_A_jerk"
								}
							},
							{
								"box": {
									"id": "obj-154",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										166.0,
										80.0,
										19.0
									],
									"text": "still thresh:"
								}
							},
							{
								"box": {
									"id": "obj-155",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										85.0,
										166.0,
										50.0,
										22.0
									],
									"minimum": 0.0,
									"maximum": 10.0,
									"value": 0.05,
									"varname": "still_thresh_A"
								}
							},
							{
								"box": {
									"id": "obj-156",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										192.0,
										90.0,
										22.0
									],
									"text": "expr $f1 < $f2"
								}
							},
							{
								"box": {
									"id": "obj-157",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										218.0,
										80.0,
										22.0
									],
									"text": "slide 200 200"
								}
							},
							{
								"box": {
									"id": "obj-158",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										10.0,
										244.0,
										100.0,
										22.0
									],
									"text": "s sm_A_still"
								}
							},
							{
								"box": {
									"id": "obj-159",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										440.0,
										40.0,
										180.0,
										19.0
									],
									"text": "\u2500\u2500 SENSOR B \u2500\u2500",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-160",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										440.0,
										62.0,
										110.0,
										22.0
									],
									"text": "r sm_B_angrate"
								}
							},
							{
								"box": {
									"id": "obj-161",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										440.0,
										88.0,
										80.0,
										22.0
									],
									"text": "unpack f f f"
								}
							},
							{
								"box": {
									"id": "obj-162",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										440.0,
										114.0,
										215.0,
										22.0
									],
									"text": "expr sqrt($f1*$f1 + $f2*$f2 + $f3*$f3)"
								}
							},
							{
								"box": {
									"id": "obj-163",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										440.0,
										140.0,
										110.0,
										22.0
									],
									"text": "s sm_B_angmag"
								}
							},
							{
								"box": {
									"id": "obj-164",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										665.0,
										62.0,
										110.0,
										22.0
									],
									"text": "r sm_B_accel"
								}
							},
							{
								"box": {
									"id": "obj-165",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										665.0,
										88.0,
										80.0,
										22.0
									],
									"text": "unpack f f f"
								}
							},
							{
								"box": {
									"id": "obj-166",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										665.0,
										114.0,
										215.0,
										22.0
									],
									"text": "expr sqrt($f1*$f1 + $f2*$f2 + $f3*$f3)"
								}
							},
							{
								"box": {
									"id": "obj-167",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										665.0,
										140.0,
										110.0,
										22.0
									],
									"text": "s sm_B_accmag"
								}
							},
							{
								"box": {
									"id": "obj-168",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"float",
										"float"
									],
									"patching_rect": [
										665.0,
										166.0,
										40.0,
										22.0
									],
									"text": "t f f"
								}
							},
							{
								"box": {
									"id": "obj-169",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										710.0,
										166.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-170",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										665.0,
										192.0,
										130.0,
										22.0
									],
									"text": "expr abs($f1 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-171",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										665.0,
										218.0,
										95.0,
										22.0
									],
									"text": "s sm_B_jerk"
								}
							},
							{
								"box": {
									"id": "obj-172",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										440.0,
										166.0,
										80.0,
										19.0
									],
									"text": "still thresh:"
								}
							},
							{
								"box": {
									"id": "obj-173",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										515.0,
										166.0,
										50.0,
										22.0
									],
									"minimum": 0.0,
									"maximum": 10.0,
									"value": 0.05,
									"varname": "still_thresh_B"
								}
							},
							{
								"box": {
									"id": "obj-174",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										440.0,
										192.0,
										90.0,
										22.0
									],
									"text": "expr $f1 < $f2"
								}
							},
							{
								"box": {
									"id": "obj-175",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										440.0,
										218.0,
										80.0,
										22.0
									],
									"text": "slide 200 200"
								}
							},
							{
								"box": {
									"id": "obj-176",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										440.0,
										244.0,
										100.0,
										22.0
									],
									"text": "s sm_B_still"
								}
							},
							{
								"box": {
									"id": "obj-177",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										870.0,
										40.0,
										180.0,
										19.0
									],
									"text": "\u2500\u2500 SENSOR C \u2500\u2500",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-178",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										870.0,
										62.0,
										110.0,
										22.0
									],
									"text": "r sm_C_angrate"
								}
							},
							{
								"box": {
									"id": "obj-179",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										870.0,
										88.0,
										80.0,
										22.0
									],
									"text": "unpack f f f"
								}
							},
							{
								"box": {
									"id": "obj-180",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										870.0,
										114.0,
										215.0,
										22.0
									],
									"text": "expr sqrt($f1*$f1 + $f2*$f2 + $f3*$f3)"
								}
							},
							{
								"box": {
									"id": "obj-181",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										870.0,
										140.0,
										110.0,
										22.0
									],
									"text": "s sm_C_angmag"
								}
							},
							{
								"box": {
									"id": "obj-182",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1095.0,
										62.0,
										110.0,
										22.0
									],
									"text": "r sm_C_accel"
								}
							},
							{
								"box": {
									"id": "obj-183",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										1095.0,
										88.0,
										80.0,
										22.0
									],
									"text": "unpack f f f"
								}
							},
							{
								"box": {
									"id": "obj-184",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1095.0,
										114.0,
										215.0,
										22.0
									],
									"text": "expr sqrt($f1*$f1 + $f2*$f2 + $f3*$f3)"
								}
							},
							{
								"box": {
									"id": "obj-185",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1095.0,
										140.0,
										110.0,
										22.0
									],
									"text": "s sm_C_accmag"
								}
							},
							{
								"box": {
									"id": "obj-186",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"float",
										"float"
									],
									"patching_rect": [
										1095.0,
										166.0,
										40.0,
										22.0
									],
									"text": "t f f"
								}
							},
							{
								"box": {
									"id": "obj-187",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1140.0,
										166.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-188",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1095.0,
										192.0,
										130.0,
										22.0
									],
									"text": "expr abs($f1 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-189",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1095.0,
										218.0,
										95.0,
										22.0
									],
									"text": "s sm_C_jerk"
								}
							},
							{
								"box": {
									"id": "obj-190",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										870.0,
										166.0,
										80.0,
										19.0
									],
									"text": "still thresh:"
								}
							},
							{
								"box": {
									"id": "obj-191",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										945.0,
										166.0,
										50.0,
										22.0
									],
									"minimum": 0.0,
									"maximum": 10.0,
									"value": 0.05,
									"varname": "still_thresh_C"
								}
							},
							{
								"box": {
									"id": "obj-192",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										870.0,
										192.0,
										90.0,
										22.0
									],
									"text": "expr $f1 < $f2"
								}
							},
							{
								"box": {
									"id": "obj-193",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										870.0,
										218.0,
										80.0,
										22.0
									],
									"text": "slide 200 200"
								}
							},
							{
								"box": {
									"id": "obj-194",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										870.0,
										244.0,
										100.0,
										22.0
									],
									"text": "s sm_C_still"
								}
							},
							{
								"box": {
									"id": "obj-195",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										260.0,
										220.0,
										19.0
									],
									"text": "\u2500\u2500 REL QUAT A\u2192B (AB) \u2500\u2500",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-196",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										282.0,
										95.0,
										22.0
									],
									"text": "r sm_A_quat"
								}
							},
							{
								"box": {
									"id": "obj-197",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										210.0,
										282.0,
										95.0,
										22.0
									],
									"text": "r sm_B_quat"
								}
							},
							{
								"box": {
									"id": "obj-198",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"float",
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										10.0,
										308.0,
										95.0,
										22.0
									],
									"text": "unpack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-199",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-200",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										50.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-201",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										90.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-202",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										130.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-203",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"float",
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										210.0,
										308.0,
										95.0,
										22.0
									],
									"text": "unpack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-204",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										210.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-205",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										250.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-206",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										290.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-207",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										330.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-208",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"bang",
										"bang",
										"bang",
										"bang"
									],
									"patching_rect": [
										10.0,
										360.0,
										65.0,
										22.0
									],
									"text": "t b b b b"
								}
							},
							{
								"box": {
									"id": "obj-209",
									"maxclass": "newobj",
									"numinlets": 8,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										386.0,
										310.0,
										22.0
									],
									"text": "expr $f2*$f1 + $f4*$f3 + $f6*$f5 + $f8*$f7"
								}
							},
							{
								"box": {
									"id": "obj-210",
									"maxclass": "newobj",
									"numinlets": 8,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										412.0,
										310.0,
										22.0
									],
									"text": "expr $f2*$f3 - $f4*$f1 - $f6*$f7 + $f8*$f5"
								}
							},
							{
								"box": {
									"id": "obj-211",
									"maxclass": "newobj",
									"numinlets": 8,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										438.0,
										310.0,
										22.0
									],
									"text": "expr $f2*$f5 + $f4*$f7 - $f6*$f1 - $f8*$f3"
								}
							},
							{
								"box": {
									"id": "obj-212",
									"maxclass": "newobj",
									"numinlets": 8,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										464.0,
										310.0,
										22.0
									],
									"text": "expr $f2*$f7 - $f4*$f5 + $f6*$f3 - $f8*$f1"
								}
							},
							{
								"box": {
									"id": "obj-213",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"bang",
										"bang",
										"bang"
									],
									"patching_rect": [
										90.0,
										360.0,
										60.0,
										22.0
									],
									"text": "t b b b"
								}
							},
							{
								"box": {
									"id": "obj-214",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										490.0,
										80.0,
										22.0
									],
									"text": "pack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-215",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										10.0,
										516.0,
										100.0,
										22.0
									],
									"text": "s sm_AB_quat"
								}
							},
							{
								"box": {
									"id": "obj-216",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										330.0,
										282.0,
										110.0,
										22.0
									],
									"text": "r sm_AB_quat"
								}
							},
							{
								"box": {
									"id": "obj-217",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"float",
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										330.0,
										308.0,
										95.0,
										22.0
									],
									"text": "unpack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-218",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										330.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-219",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										370.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-220",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										410.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-221",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										450.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-222",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"bang",
										"bang",
										"bang"
									],
									"patching_rect": [
										330.0,
										360.0,
										60.0,
										22.0
									],
									"text": "t b b b"
								}
							},
							{
								"box": {
									"id": "obj-223",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										330.0,
										386.0,
										390.0,
										22.0
									],
									"text": "expr atan2(2.0*($f1*$f2 + $f3*$f4), 1.0 - 2.0*($f2*$f2 + $f3*$f3)) * 57.296"
								}
							},
							{
								"box": {
									"id": "obj-224",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										330.0,
										412.0,
										290.0,
										22.0
									],
									"text": "expr asin(2.0*($f1*$f3 - $f4*$f2)) * 57.296"
								}
							},
							{
								"box": {
									"id": "obj-225",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										330.0,
										438.0,
										390.0,
										22.0
									],
									"text": "expr atan2(2.0*($f1*$f4 + $f2*$f3), 1.0 - 2.0*($f3*$f3 + $f4*$f4)) * 57.296"
								}
							},
							{
								"box": {
									"id": "obj-226",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										330.0,
										464.0,
										110.0,
										22.0
									],
									"text": "s sm_AB_pitch"
								}
							},
							{
								"box": {
									"id": "obj-227",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										445.0,
										464.0,
										110.0,
										22.0
									],
									"text": "s sm_AB_roll"
								}
							},
							{
								"box": {
									"id": "obj-228",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										560.0,
										464.0,
										110.0,
										22.0
									],
									"text": "s sm_AB_yaw"
								}
							},
							{
								"box": {
									"id": "obj-229",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										450.0,
										260.0,
										220.0,
										19.0
									],
									"text": "\u2500\u2500 REL QUAT A\u2192C (AC) \u2500\u2500",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-230",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										450.0,
										282.0,
										95.0,
										22.0
									],
									"text": "r sm_A_quat"
								}
							},
							{
								"box": {
									"id": "obj-231",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										650.0,
										282.0,
										95.0,
										22.0
									],
									"text": "r sm_C_quat"
								}
							},
							{
								"box": {
									"id": "obj-232",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"float",
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										450.0,
										308.0,
										95.0,
										22.0
									],
									"text": "unpack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-233",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										450.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-234",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										490.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-235",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										530.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-236",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										570.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-237",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"float",
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										650.0,
										308.0,
										95.0,
										22.0
									],
									"text": "unpack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-238",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										650.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-239",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										690.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-240",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										730.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-241",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										770.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-242",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"bang",
										"bang",
										"bang",
										"bang"
									],
									"patching_rect": [
										450.0,
										360.0,
										65.0,
										22.0
									],
									"text": "t b b b b"
								}
							},
							{
								"box": {
									"id": "obj-243",
									"maxclass": "newobj",
									"numinlets": 8,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										450.0,
										386.0,
										310.0,
										22.0
									],
									"text": "expr $f2*$f1 + $f4*$f3 + $f6*$f5 + $f8*$f7"
								}
							},
							{
								"box": {
									"id": "obj-244",
									"maxclass": "newobj",
									"numinlets": 8,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										450.0,
										412.0,
										310.0,
										22.0
									],
									"text": "expr $f2*$f3 - $f4*$f1 - $f6*$f7 + $f8*$f5"
								}
							},
							{
								"box": {
									"id": "obj-245",
									"maxclass": "newobj",
									"numinlets": 8,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										450.0,
										438.0,
										310.0,
										22.0
									],
									"text": "expr $f2*$f5 + $f4*$f7 - $f6*$f1 - $f8*$f3"
								}
							},
							{
								"box": {
									"id": "obj-246",
									"maxclass": "newobj",
									"numinlets": 8,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										450.0,
										464.0,
										310.0,
										22.0
									],
									"text": "expr $f2*$f7 - $f4*$f5 + $f6*$f3 - $f8*$f1"
								}
							},
							{
								"box": {
									"id": "obj-247",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"bang",
										"bang",
										"bang"
									],
									"patching_rect": [
										530.0,
										360.0,
										60.0,
										22.0
									],
									"text": "t b b b"
								}
							},
							{
								"box": {
									"id": "obj-248",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										450.0,
										490.0,
										80.0,
										22.0
									],
									"text": "pack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-249",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										450.0,
										516.0,
										100.0,
										22.0
									],
									"text": "s sm_AC_quat"
								}
							},
							{
								"box": {
									"id": "obj-250",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										770.0,
										282.0,
										110.0,
										22.0
									],
									"text": "r sm_AC_quat"
								}
							},
							{
								"box": {
									"id": "obj-251",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"float",
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										770.0,
										308.0,
										95.0,
										22.0
									],
									"text": "unpack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-252",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										770.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-253",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										810.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-254",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										850.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-255",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										890.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-256",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"bang",
										"bang",
										"bang"
									],
									"patching_rect": [
										770.0,
										360.0,
										60.0,
										22.0
									],
									"text": "t b b b"
								}
							},
							{
								"box": {
									"id": "obj-257",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										770.0,
										386.0,
										390.0,
										22.0
									],
									"text": "expr atan2(2.0*($f1*$f2 + $f3*$f4), 1.0 - 2.0*($f2*$f2 + $f3*$f3)) * 57.296"
								}
							},
							{
								"box": {
									"id": "obj-258",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										770.0,
										412.0,
										290.0,
										22.0
									],
									"text": "expr asin(2.0*($f1*$f3 - $f4*$f2)) * 57.296"
								}
							},
							{
								"box": {
									"id": "obj-259",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										770.0,
										438.0,
										390.0,
										22.0
									],
									"text": "expr atan2(2.0*($f1*$f4 + $f2*$f3), 1.0 - 2.0*($f3*$f3 + $f4*$f4)) * 57.296"
								}
							},
							{
								"box": {
									"id": "obj-260",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										770.0,
										464.0,
										110.0,
										22.0
									],
									"text": "s sm_AC_pitch"
								}
							},
							{
								"box": {
									"id": "obj-261",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										885.0,
										464.0,
										110.0,
										22.0
									],
									"text": "s sm_AC_roll"
								}
							},
							{
								"box": {
									"id": "obj-262",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1000.0,
										464.0,
										110.0,
										22.0
									],
									"text": "s sm_AC_yaw"
								}
							},
							{
								"box": {
									"id": "obj-263",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										890.0,
										260.0,
										220.0,
										19.0
									],
									"text": "\u2500\u2500 REL QUAT B\u2192C (BC) \u2500\u2500",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-264",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										890.0,
										282.0,
										95.0,
										22.0
									],
									"text": "r sm_B_quat"
								}
							},
							{
								"box": {
									"id": "obj-265",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1090.0,
										282.0,
										95.0,
										22.0
									],
									"text": "r sm_C_quat"
								}
							},
							{
								"box": {
									"id": "obj-266",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"float",
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										890.0,
										308.0,
										95.0,
										22.0
									],
									"text": "unpack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-267",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										890.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-268",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										930.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-269",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										970.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-270",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1010.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-271",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"float",
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										1090.0,
										308.0,
										95.0,
										22.0
									],
									"text": "unpack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-272",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1090.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-273",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1130.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-274",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1170.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-275",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1210.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-276",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"bang",
										"bang",
										"bang",
										"bang"
									],
									"patching_rect": [
										890.0,
										360.0,
										65.0,
										22.0
									],
									"text": "t b b b b"
								}
							},
							{
								"box": {
									"id": "obj-277",
									"maxclass": "newobj",
									"numinlets": 8,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										890.0,
										386.0,
										310.0,
										22.0
									],
									"text": "expr $f2*$f1 + $f4*$f3 + $f6*$f5 + $f8*$f7"
								}
							},
							{
								"box": {
									"id": "obj-278",
									"maxclass": "newobj",
									"numinlets": 8,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										890.0,
										412.0,
										310.0,
										22.0
									],
									"text": "expr $f2*$f3 - $f4*$f1 - $f6*$f7 + $f8*$f5"
								}
							},
							{
								"box": {
									"id": "obj-279",
									"maxclass": "newobj",
									"numinlets": 8,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										890.0,
										438.0,
										310.0,
										22.0
									],
									"text": "expr $f2*$f5 + $f4*$f7 - $f6*$f1 - $f8*$f3"
								}
							},
							{
								"box": {
									"id": "obj-280",
									"maxclass": "newobj",
									"numinlets": 8,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										890.0,
										464.0,
										310.0,
										22.0
									],
									"text": "expr $f2*$f7 - $f4*$f5 + $f6*$f3 - $f8*$f1"
								}
							},
							{
								"box": {
									"id": "obj-281",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"bang",
										"bang",
										"bang"
									],
									"patching_rect": [
										970.0,
										360.0,
										60.0,
										22.0
									],
									"text": "t b b b"
								}
							},
							{
								"box": {
									"id": "obj-282",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										890.0,
										490.0,
										80.0,
										22.0
									],
									"text": "pack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-283",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										890.0,
										516.0,
										100.0,
										22.0
									],
									"text": "s sm_BC_quat"
								}
							},
							{
								"box": {
									"id": "obj-284",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1210.0,
										282.0,
										110.0,
										22.0
									],
									"text": "r sm_BC_quat"
								}
							},
							{
								"box": {
									"id": "obj-285",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 4,
									"outlettype": [
										"float",
										"float",
										"float",
										"float"
									],
									"patching_rect": [
										1210.0,
										308.0,
										95.0,
										22.0
									],
									"text": "unpack f f f f"
								}
							},
							{
								"box": {
									"id": "obj-286",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1210.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-287",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1250.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-288",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1290.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-289",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1330.0,
										334.0,
										35.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-290",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"bang",
										"bang",
										"bang"
									],
									"patching_rect": [
										1210.0,
										360.0,
										60.0,
										22.0
									],
									"text": "t b b b"
								}
							},
							{
								"box": {
									"id": "obj-291",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1210.0,
										386.0,
										390.0,
										22.0
									],
									"text": "expr atan2(2.0*($f1*$f2 + $f3*$f4), 1.0 - 2.0*($f2*$f2 + $f3*$f3)) * 57.296"
								}
							},
							{
								"box": {
									"id": "obj-292",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1210.0,
										412.0,
										290.0,
										22.0
									],
									"text": "expr asin(2.0*($f1*$f3 - $f4*$f2)) * 57.296"
								}
							},
							{
								"box": {
									"id": "obj-293",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1210.0,
										438.0,
										390.0,
										22.0
									],
									"text": "expr atan2(2.0*($f1*$f4 + $f2*$f3), 1.0 - 2.0*($f3*$f3 + $f4*$f4)) * 57.296"
								}
							},
							{
								"box": {
									"id": "obj-294",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1210.0,
										464.0,
										110.0,
										22.0
									],
									"text": "s sm_BC_pitch"
								}
							},
							{
								"box": {
									"id": "obj-295",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1325.0,
										464.0,
										110.0,
										22.0
									],
									"text": "s sm_BC_roll"
								}
							},
							{
								"box": {
									"id": "obj-296",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1440.0,
										464.0,
										110.0,
										22.0
									],
									"text": "s sm_BC_yaw"
								}
							}
						],
						"lines": [
							{
								"patchline": {
									"source": [
										"obj-142",
										0
									],
									"destination": [
										"obj-143",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-143",
										0
									],
									"destination": [
										"obj-144",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-143",
										1
									],
									"destination": [
										"obj-144",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-143",
										2
									],
									"destination": [
										"obj-144",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-144",
										0
									],
									"destination": [
										"obj-145",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-146",
										0
									],
									"destination": [
										"obj-147",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-147",
										0
									],
									"destination": [
										"obj-148",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-147",
										1
									],
									"destination": [
										"obj-148",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-147",
										2
									],
									"destination": [
										"obj-148",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-148",
										0
									],
									"destination": [
										"obj-149",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-148",
										0
									],
									"destination": [
										"obj-150",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-150",
										1
									],
									"destination": [
										"obj-152",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-150",
										0
									],
									"destination": [
										"obj-151",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-151",
										0
									],
									"destination": [
										"obj-152",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-152",
										0
									],
									"destination": [
										"obj-151",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-152",
										0
									],
									"destination": [
										"obj-153",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-144",
										0
									],
									"destination": [
										"obj-156",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-155",
										0
									],
									"destination": [
										"obj-156",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-156",
										0
									],
									"destination": [
										"obj-157",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-157",
										0
									],
									"destination": [
										"obj-158",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-160",
										0
									],
									"destination": [
										"obj-161",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-161",
										0
									],
									"destination": [
										"obj-162",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-161",
										1
									],
									"destination": [
										"obj-162",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-161",
										2
									],
									"destination": [
										"obj-162",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-162",
										0
									],
									"destination": [
										"obj-163",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-164",
										0
									],
									"destination": [
										"obj-165",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-165",
										0
									],
									"destination": [
										"obj-166",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-165",
										1
									],
									"destination": [
										"obj-166",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-165",
										2
									],
									"destination": [
										"obj-166",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-166",
										0
									],
									"destination": [
										"obj-167",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-166",
										0
									],
									"destination": [
										"obj-168",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-168",
										1
									],
									"destination": [
										"obj-170",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-168",
										0
									],
									"destination": [
										"obj-169",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-169",
										0
									],
									"destination": [
										"obj-170",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-170",
										0
									],
									"destination": [
										"obj-169",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-170",
										0
									],
									"destination": [
										"obj-171",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-162",
										0
									],
									"destination": [
										"obj-174",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-173",
										0
									],
									"destination": [
										"obj-174",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-174",
										0
									],
									"destination": [
										"obj-175",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-175",
										0
									],
									"destination": [
										"obj-176",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-178",
										0
									],
									"destination": [
										"obj-179",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-179",
										0
									],
									"destination": [
										"obj-180",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-179",
										1
									],
									"destination": [
										"obj-180",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-179",
										2
									],
									"destination": [
										"obj-180",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-180",
										0
									],
									"destination": [
										"obj-181",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-182",
										0
									],
									"destination": [
										"obj-183",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-183",
										0
									],
									"destination": [
										"obj-184",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-183",
										1
									],
									"destination": [
										"obj-184",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-183",
										2
									],
									"destination": [
										"obj-184",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-184",
										0
									],
									"destination": [
										"obj-185",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-184",
										0
									],
									"destination": [
										"obj-186",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-186",
										1
									],
									"destination": [
										"obj-188",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-186",
										0
									],
									"destination": [
										"obj-187",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-187",
										0
									],
									"destination": [
										"obj-188",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-188",
										0
									],
									"destination": [
										"obj-187",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-188",
										0
									],
									"destination": [
										"obj-189",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-180",
										0
									],
									"destination": [
										"obj-192",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-191",
										0
									],
									"destination": [
										"obj-192",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-192",
										0
									],
									"destination": [
										"obj-193",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-193",
										0
									],
									"destination": [
										"obj-194",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-196",
										0
									],
									"destination": [
										"obj-198",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-197",
										0
									],
									"destination": [
										"obj-203",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-198",
										1
									],
									"destination": [
										"obj-199",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-198",
										2
									],
									"destination": [
										"obj-200",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-198",
										3
									],
									"destination": [
										"obj-201",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-198",
										0
									],
									"destination": [
										"obj-202",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-203",
										0
									],
									"destination": [
										"obj-207",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-203",
										1
									],
									"destination": [
										"obj-204",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-203",
										2
									],
									"destination": [
										"obj-205",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-203",
										3
									],
									"destination": [
										"obj-206",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-202",
										0
									],
									"destination": [
										"obj-208",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-202",
										0
									],
									"destination": [
										"obj-209",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-207",
										0
									],
									"destination": [
										"obj-209",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-199",
										0
									],
									"destination": [
										"obj-209",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-204",
										0
									],
									"destination": [
										"obj-209",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-200",
										0
									],
									"destination": [
										"obj-209",
										4
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-205",
										0
									],
									"destination": [
										"obj-209",
										5
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-201",
										0
									],
									"destination": [
										"obj-209",
										6
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-206",
										0
									],
									"destination": [
										"obj-209",
										7
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-202",
										0
									],
									"destination": [
										"obj-210",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-207",
										0
									],
									"destination": [
										"obj-210",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-199",
										0
									],
									"destination": [
										"obj-210",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-204",
										0
									],
									"destination": [
										"obj-210",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-200",
										0
									],
									"destination": [
										"obj-210",
										4
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-205",
										0
									],
									"destination": [
										"obj-210",
										5
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-201",
										0
									],
									"destination": [
										"obj-210",
										6
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-206",
										0
									],
									"destination": [
										"obj-210",
										7
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-202",
										0
									],
									"destination": [
										"obj-211",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-207",
										0
									],
									"destination": [
										"obj-211",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-199",
										0
									],
									"destination": [
										"obj-211",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-204",
										0
									],
									"destination": [
										"obj-211",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-200",
										0
									],
									"destination": [
										"obj-211",
										4
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-205",
										0
									],
									"destination": [
										"obj-211",
										5
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-201",
										0
									],
									"destination": [
										"obj-211",
										6
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-206",
										0
									],
									"destination": [
										"obj-211",
										7
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-202",
										0
									],
									"destination": [
										"obj-212",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-207",
										0
									],
									"destination": [
										"obj-212",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-199",
										0
									],
									"destination": [
										"obj-212",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-204",
										0
									],
									"destination": [
										"obj-212",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-200",
										0
									],
									"destination": [
										"obj-212",
										4
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-205",
										0
									],
									"destination": [
										"obj-212",
										5
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-201",
										0
									],
									"destination": [
										"obj-212",
										6
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-206",
										0
									],
									"destination": [
										"obj-212",
										7
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-208",
										0
									],
									"destination": [
										"obj-201",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-208",
										1
									],
									"destination": [
										"obj-200",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-208",
										2
									],
									"destination": [
										"obj-199",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-208",
										3
									],
									"destination": [
										"obj-207",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-202",
										0
									],
									"destination": [
										"obj-213",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-213",
										0
									],
									"destination": [
										"obj-206",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-213",
										1
									],
									"destination": [
										"obj-205",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-213",
										2
									],
									"destination": [
										"obj-204",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-210",
										0
									],
									"destination": [
										"obj-214",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-211",
										0
									],
									"destination": [
										"obj-214",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-212",
										0
									],
									"destination": [
										"obj-214",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-209",
										0
									],
									"destination": [
										"obj-214",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-214",
										0
									],
									"destination": [
										"obj-215",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-216",
										0
									],
									"destination": [
										"obj-217",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-217",
										1
									],
									"destination": [
										"obj-218",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-217",
										2
									],
									"destination": [
										"obj-219",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-217",
										3
									],
									"destination": [
										"obj-220",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-217",
										0
									],
									"destination": [
										"obj-221",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-221",
										0
									],
									"destination": [
										"obj-222",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-222",
										0
									],
									"destination": [
										"obj-220",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-222",
										1
									],
									"destination": [
										"obj-219",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-222",
										2
									],
									"destination": [
										"obj-218",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-221",
										0
									],
									"destination": [
										"obj-223",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-218",
										0
									],
									"destination": [
										"obj-223",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-219",
										0
									],
									"destination": [
										"obj-223",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-220",
										0
									],
									"destination": [
										"obj-223",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-221",
										0
									],
									"destination": [
										"obj-224",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-218",
										0
									],
									"destination": [
										"obj-224",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-219",
										0
									],
									"destination": [
										"obj-224",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-220",
										0
									],
									"destination": [
										"obj-224",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-221",
										0
									],
									"destination": [
										"obj-225",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-218",
										0
									],
									"destination": [
										"obj-225",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-219",
										0
									],
									"destination": [
										"obj-225",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-220",
										0
									],
									"destination": [
										"obj-225",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-223",
										0
									],
									"destination": [
										"obj-226",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-224",
										0
									],
									"destination": [
										"obj-227",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-225",
										0
									],
									"destination": [
										"obj-228",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-230",
										0
									],
									"destination": [
										"obj-232",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-231",
										0
									],
									"destination": [
										"obj-237",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-232",
										1
									],
									"destination": [
										"obj-233",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-232",
										2
									],
									"destination": [
										"obj-234",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-232",
										3
									],
									"destination": [
										"obj-235",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-232",
										0
									],
									"destination": [
										"obj-236",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-237",
										0
									],
									"destination": [
										"obj-241",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-237",
										1
									],
									"destination": [
										"obj-238",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-237",
										2
									],
									"destination": [
										"obj-239",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-237",
										3
									],
									"destination": [
										"obj-240",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-236",
										0
									],
									"destination": [
										"obj-242",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-236",
										0
									],
									"destination": [
										"obj-243",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-241",
										0
									],
									"destination": [
										"obj-243",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-233",
										0
									],
									"destination": [
										"obj-243",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-238",
										0
									],
									"destination": [
										"obj-243",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-234",
										0
									],
									"destination": [
										"obj-243",
										4
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-239",
										0
									],
									"destination": [
										"obj-243",
										5
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-235",
										0
									],
									"destination": [
										"obj-243",
										6
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-240",
										0
									],
									"destination": [
										"obj-243",
										7
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-236",
										0
									],
									"destination": [
										"obj-244",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-241",
										0
									],
									"destination": [
										"obj-244",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-233",
										0
									],
									"destination": [
										"obj-244",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-238",
										0
									],
									"destination": [
										"obj-244",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-234",
										0
									],
									"destination": [
										"obj-244",
										4
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-239",
										0
									],
									"destination": [
										"obj-244",
										5
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-235",
										0
									],
									"destination": [
										"obj-244",
										6
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-240",
										0
									],
									"destination": [
										"obj-244",
										7
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-236",
										0
									],
									"destination": [
										"obj-245",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-241",
										0
									],
									"destination": [
										"obj-245",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-233",
										0
									],
									"destination": [
										"obj-245",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-238",
										0
									],
									"destination": [
										"obj-245",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-234",
										0
									],
									"destination": [
										"obj-245",
										4
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-239",
										0
									],
									"destination": [
										"obj-245",
										5
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-235",
										0
									],
									"destination": [
										"obj-245",
										6
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-240",
										0
									],
									"destination": [
										"obj-245",
										7
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-236",
										0
									],
									"destination": [
										"obj-246",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-241",
										0
									],
									"destination": [
										"obj-246",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-233",
										0
									],
									"destination": [
										"obj-246",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-238",
										0
									],
									"destination": [
										"obj-246",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-234",
										0
									],
									"destination": [
										"obj-246",
										4
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-239",
										0
									],
									"destination": [
										"obj-246",
										5
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-235",
										0
									],
									"destination": [
										"obj-246",
										6
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-240",
										0
									],
									"destination": [
										"obj-246",
										7
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-242",
										0
									],
									"destination": [
										"obj-235",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-242",
										1
									],
									"destination": [
										"obj-234",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-242",
										2
									],
									"destination": [
										"obj-233",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-242",
										3
									],
									"destination": [
										"obj-241",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-236",
										0
									],
									"destination": [
										"obj-247",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-247",
										0
									],
									"destination": [
										"obj-240",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-247",
										1
									],
									"destination": [
										"obj-239",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-247",
										2
									],
									"destination": [
										"obj-238",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-244",
										0
									],
									"destination": [
										"obj-248",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-245",
										0
									],
									"destination": [
										"obj-248",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-246",
										0
									],
									"destination": [
										"obj-248",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-243",
										0
									],
									"destination": [
										"obj-248",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-248",
										0
									],
									"destination": [
										"obj-249",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-250",
										0
									],
									"destination": [
										"obj-251",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-251",
										1
									],
									"destination": [
										"obj-252",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-251",
										2
									],
									"destination": [
										"obj-253",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-251",
										3
									],
									"destination": [
										"obj-254",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-251",
										0
									],
									"destination": [
										"obj-255",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-255",
										0
									],
									"destination": [
										"obj-256",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-256",
										0
									],
									"destination": [
										"obj-254",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-256",
										1
									],
									"destination": [
										"obj-253",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-256",
										2
									],
									"destination": [
										"obj-252",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-255",
										0
									],
									"destination": [
										"obj-257",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-252",
										0
									],
									"destination": [
										"obj-257",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-253",
										0
									],
									"destination": [
										"obj-257",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-254",
										0
									],
									"destination": [
										"obj-257",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-255",
										0
									],
									"destination": [
										"obj-258",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-252",
										0
									],
									"destination": [
										"obj-258",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-253",
										0
									],
									"destination": [
										"obj-258",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-254",
										0
									],
									"destination": [
										"obj-258",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-255",
										0
									],
									"destination": [
										"obj-259",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-252",
										0
									],
									"destination": [
										"obj-259",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-253",
										0
									],
									"destination": [
										"obj-259",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-254",
										0
									],
									"destination": [
										"obj-259",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-257",
										0
									],
									"destination": [
										"obj-260",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-258",
										0
									],
									"destination": [
										"obj-261",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-259",
										0
									],
									"destination": [
										"obj-262",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-264",
										0
									],
									"destination": [
										"obj-266",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-265",
										0
									],
									"destination": [
										"obj-271",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-266",
										1
									],
									"destination": [
										"obj-267",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-266",
										2
									],
									"destination": [
										"obj-268",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-266",
										3
									],
									"destination": [
										"obj-269",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-266",
										0
									],
									"destination": [
										"obj-270",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-271",
										0
									],
									"destination": [
										"obj-275",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-271",
										1
									],
									"destination": [
										"obj-272",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-271",
										2
									],
									"destination": [
										"obj-273",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-271",
										3
									],
									"destination": [
										"obj-274",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-270",
										0
									],
									"destination": [
										"obj-276",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-270",
										0
									],
									"destination": [
										"obj-277",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-275",
										0
									],
									"destination": [
										"obj-277",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-267",
										0
									],
									"destination": [
										"obj-277",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-272",
										0
									],
									"destination": [
										"obj-277",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-268",
										0
									],
									"destination": [
										"obj-277",
										4
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-273",
										0
									],
									"destination": [
										"obj-277",
										5
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-269",
										0
									],
									"destination": [
										"obj-277",
										6
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-274",
										0
									],
									"destination": [
										"obj-277",
										7
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-270",
										0
									],
									"destination": [
										"obj-278",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-275",
										0
									],
									"destination": [
										"obj-278",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-267",
										0
									],
									"destination": [
										"obj-278",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-272",
										0
									],
									"destination": [
										"obj-278",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-268",
										0
									],
									"destination": [
										"obj-278",
										4
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-273",
										0
									],
									"destination": [
										"obj-278",
										5
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-269",
										0
									],
									"destination": [
										"obj-278",
										6
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-274",
										0
									],
									"destination": [
										"obj-278",
										7
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-270",
										0
									],
									"destination": [
										"obj-279",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-275",
										0
									],
									"destination": [
										"obj-279",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-267",
										0
									],
									"destination": [
										"obj-279",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-272",
										0
									],
									"destination": [
										"obj-279",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-268",
										0
									],
									"destination": [
										"obj-279",
										4
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-273",
										0
									],
									"destination": [
										"obj-279",
										5
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-269",
										0
									],
									"destination": [
										"obj-279",
										6
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-274",
										0
									],
									"destination": [
										"obj-279",
										7
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-270",
										0
									],
									"destination": [
										"obj-280",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-275",
										0
									],
									"destination": [
										"obj-280",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-267",
										0
									],
									"destination": [
										"obj-280",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-272",
										0
									],
									"destination": [
										"obj-280",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-268",
										0
									],
									"destination": [
										"obj-280",
										4
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-273",
										0
									],
									"destination": [
										"obj-280",
										5
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-269",
										0
									],
									"destination": [
										"obj-280",
										6
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-274",
										0
									],
									"destination": [
										"obj-280",
										7
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-276",
										0
									],
									"destination": [
										"obj-269",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-276",
										1
									],
									"destination": [
										"obj-268",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-276",
										2
									],
									"destination": [
										"obj-267",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-276",
										3
									],
									"destination": [
										"obj-275",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-270",
										0
									],
									"destination": [
										"obj-281",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-281",
										0
									],
									"destination": [
										"obj-274",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-281",
										1
									],
									"destination": [
										"obj-273",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-281",
										2
									],
									"destination": [
										"obj-272",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-278",
										0
									],
									"destination": [
										"obj-282",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-279",
										0
									],
									"destination": [
										"obj-282",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-280",
										0
									],
									"destination": [
										"obj-282",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-277",
										0
									],
									"destination": [
										"obj-282",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-282",
										0
									],
									"destination": [
										"obj-283",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-284",
										0
									],
									"destination": [
										"obj-285",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-285",
										1
									],
									"destination": [
										"obj-286",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-285",
										2
									],
									"destination": [
										"obj-287",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-285",
										3
									],
									"destination": [
										"obj-288",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-285",
										0
									],
									"destination": [
										"obj-289",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-289",
										0
									],
									"destination": [
										"obj-290",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-290",
										0
									],
									"destination": [
										"obj-288",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-290",
										1
									],
									"destination": [
										"obj-287",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-290",
										2
									],
									"destination": [
										"obj-286",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-289",
										0
									],
									"destination": [
										"obj-291",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-286",
										0
									],
									"destination": [
										"obj-291",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-287",
										0
									],
									"destination": [
										"obj-291",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-288",
										0
									],
									"destination": [
										"obj-291",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-289",
										0
									],
									"destination": [
										"obj-292",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-286",
										0
									],
									"destination": [
										"obj-292",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-287",
										0
									],
									"destination": [
										"obj-292",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-288",
										0
									],
									"destination": [
										"obj-292",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-289",
										0
									],
									"destination": [
										"obj-293",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-286",
										0
									],
									"destination": [
										"obj-293",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-287",
										0
									],
									"destination": [
										"obj-293",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-288",
										0
									],
									"destination": [
										"obj-293",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-291",
										0
									],
									"destination": [
										"obj-294",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-292",
										0
									],
									"destination": [
										"obj-295",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-293",
										0
									],
									"destination": [
										"obj-296",
										0
									]
								}
							}
						]
					}
				}
			},
			{
				"box": {
					"id": "obj-661",
					"maxclass": "newobj",
					"numinlets": 0,
					"numoutlets": 0,
					"outlettype": [],
					"patching_rect": [
						10.0,
						160.0,
						138,
						22.0
					],
					"text": "p mapping_engine",
					"patcher": {
						"fileversion": 1,
						"appversion": {
							"major": 9,
							"minor": 0,
							"revision": 5,
							"architecture": "x64",
							"modernui": 1
						},
						"classnamespace": "box",
						"rect": [
							0.0,
							0.0,
							1340.0,
							680.0
						],
						"gridsize": [
							15.0,
							15.0
						],
						"boxes": [
							{
								"box": {
									"id": "obj-297",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										8.0,
										750.0,
										19.0
									],
									"text": "p mapping_engine \u2014 8 mapping slots: source \u2192 scale \u2192 curve \u2192 smooth \u2192 invert/mute \u2192 OSC \u2192 osc-hub",
									"fontface": 1,
									"fontsize": 12.0
								}
							},
							{
								"box": {
									"id": "obj-298",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										28.0,
										110.0,
										19.0
									],
									"text": "GLOBAL BYPASS"
								}
							},
							{
								"box": {
									"id": "obj-299",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										10.0,
										48.0,
										24.0,
										24.0
									],
									"varname": "global_bypass"
								}
							},
							{
								"box": {
									"id": "obj-300",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										38.0,
										51.0,
										350.0,
										19.0
									],
									"text": "(bypass blocks all slot output \u2014 toggle off to enable)"
								}
							},
							{
								"box": {
									"id": "obj-301",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										12.0,
										12.0,
										150.0,
										19.0
									],
									"text": "SLOT 1",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-302",
									"maxclass": "umenu",
									"items": [
										"sm_A_angmag",
										"sm_A_accmag",
										"sm_A_jerk",
										"sm_A_still",
										"sm_A_angx",
										"sm_A_angy",
										"sm_A_angz",
										"sm_A_dirx",
										"sm_A_diry",
										"sm_A_dirz",
										"sm_A_az",
										"sm_B_angmag",
										"sm_B_accmag",
										"sm_B_jerk",
										"sm_B_still",
										"sm_B_angx",
										"sm_B_angy",
										"sm_B_angz",
										"sm_B_dirx",
										"sm_B_diry",
										"sm_B_dirz",
										"sm_B_az",
										"sm_C_angmag",
										"sm_C_accmag",
										"sm_C_jerk",
										"sm_C_still",
										"sm_C_angx",
										"sm_C_angy",
										"sm_C_angz",
										"sm_C_dirx",
										"sm_C_diry",
										"sm_C_dirz",
										"sm_C_az",
										"sm_AB_pitch",
										"sm_AB_roll",
										"sm_AB_yaw",
										"sm_AC_pitch",
										"sm_AC_roll",
										"sm_AC_yaw",
										"sm_BC_pitch",
										"sm_BC_roll",
										"sm_BC_yaw"
									],
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"int",
										"",
										""
									],
									"allowdrag": 0,
									"parameter_enable": 1,
									"patching_rect": [
										10.0,
										30.0,
										155.0,
										22.0
									],
									"varname": "s1_src"
								}
							},
							{
								"box": {
									"id": "obj-303",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										58.0,
										155.0,
										22.0
									],
									"text": "r sm_A_angmag"
								}
							},
							{
								"box": {
									"id": "obj-304",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										86.0,
										85.0,
										22.0
									],
									"text": "prepend set"
								}
							},
							{
								"box": {
									"id": "obj-305",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										114.0,
										45.0,
										19.0
									],
									"text": "in min"
								}
							},
							{
								"box": {
									"id": "obj-306",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										70.0,
										114.0,
										45.0,
										19.0
									],
									"text": "in max"
								}
							},
							{
								"box": {
									"id": "obj-307",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										10.0,
										130.0,
										55.0,
										22.0
									],
									"value": 0.0,
									"varname": "s1_in_lo"
								}
							},
							{
								"box": {
									"id": "obj-308",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										70.0,
										130.0,
										55.0,
										22.0
									],
									"value": 1.0,
									"varname": "s1_in_hi"
								}
							},
							{
								"box": {
									"id": "obj-309",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										156.0,
										195.0,
										22.0
									],
									"text": "expr ($f1 - $f2) / ($f3 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-310",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										182.0,
										240.0,
										22.0
									],
									"text": "expr $f1 < 0.0 ? 0.0 : $f1 > 1.0 ? 1.0 : $f1"
								}
							},
							{
								"box": {
									"id": "obj-311",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										208.0,
										60.0,
										19.0
									],
									"text": "curve"
								}
							},
							{
								"box": {
									"id": "obj-312",
									"maxclass": "umenu",
									"items": [
										"0-linear",
										"1-exp (x^2)",
										"2-log",
										"3-S-curve"
									],
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"int",
										"",
										""
									],
									"allowdrag": 0,
									"parameter_enable": 1,
									"patching_rect": [
										10.0,
										224.0,
										155.0,
										22.0
									],
									"varname": "s1_curve"
								}
							},
							{
								"box": {
									"id": "obj-313",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										170.0,
										224.0,
										30.0,
										22.0
									],
									"text": "+ 1"
								}
							},
							{
								"box": {
									"id": "obj-314",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 4,
									"outlettype": [
										"",
										"",
										"",
										""
									],
									"patching_rect": [
										170.0,
										250.0,
										50.0,
										22.0
									],
									"text": "gate 4"
								}
							},
							{
								"box": {
									"id": "obj-315",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										282.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-316",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										55.0,
										282.0,
										110.0,
										22.0
									],
									"text": "expr pow($f1, 2.0)"
								}
							},
							{
								"box": {
									"id": "obj-317",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										308.0,
										210.0,
										22.0
									],
									"text": "expr (pow(100.0, $f1) - 1.0) * 0.010101"
								}
							},
							{
								"box": {
									"id": "obj-318",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										334.0,
										200.0,
										22.0
									],
									"text": "expr 3.0*$f1*$f1 - 2.0*$f1*$f1*$f1"
								}
							},
							{
								"box": {
									"id": "obj-319",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										360.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-320",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										386.0,
										50.0,
										19.0
									],
									"text": "out min"
								}
							},
							{
								"box": {
									"id": "obj-321",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										75.0,
										386.0,
										50.0,
										19.0
									],
									"text": "out max"
								}
							},
							{
								"box": {
									"id": "obj-322",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										10.0,
										402.0,
										55.0,
										22.0
									],
									"value": 0.0,
									"varname": "s1_out_lo"
								}
							},
							{
								"box": {
									"id": "obj-323",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										75.0,
										402.0,
										55.0,
										22.0
									],
									"value": 1.0,
									"varname": "s1_out_hi"
								}
							},
							{
								"box": {
									"id": "obj-324",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										428.0,
										190.0,
										22.0
									],
									"text": "expr $f2 + $f1 * ($f3 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-325",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										454.0,
										55.0,
										19.0
									],
									"text": "smooth"
								}
							},
							{
								"box": {
									"id": "obj-326",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										65.0,
										454.0,
										50.0,
										22.0
									],
									"minimum": 0.0,
									"maximum": 5000.0,
									"value": 0.0,
									"varname": "s1_smooth"
								}
							},
							{
								"box": {
									"id": "obj-327",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										470.0,
										65.0,
										22.0
									],
									"text": "slide 0 0"
								}
							},
							{
								"box": {
									"id": "obj-328",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										496.0,
										25.0,
										19.0
									],
									"text": "inv"
								}
							},
							{
								"box": {
									"id": "obj-329",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										38.0,
										496.0,
										24.0,
										24.0
									],
									"varname": "s1_invert"
								}
							},
							{
								"box": {
									"id": "obj-330",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										522.0,
										200.0,
										22.0
									],
									"text": "expr $i2 ? $f4 + $f3 - $f1 : $f1"
								}
							},
							{
								"box": {
									"id": "obj-331",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										120.0,
										496.0,
										35.0,
										19.0
									],
									"text": "mute"
								}
							},
							{
								"box": {
									"id": "obj-332",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										158.0,
										496.0,
										24.0,
										24.0
									],
									"varname": "s1_mute"
								}
							},
							{
								"box": {
									"id": "obj-333",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										548.0,
										140.0,
										22.0
									],
									"text": "expr (1 - $i2) * $f1"
								}
							},
							{
								"box": {
									"id": "obj-334",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										574.0,
										65.0,
										19.0
									],
									"text": "OSC addr:"
								}
							},
							{
								"box": {
									"id": "obj-335",
									"maxclass": "textedit",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"parameter_enable": 1,
									"patching_rect": [
										78.0,
										574.0,
										87.0,
										22.0
									],
									"varname": "s1_addr",
									"text": "/map/slot1"
								}
							},
							{
								"box": {
									"id": "obj-336",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										600.0,
										80.0,
										22.0
									],
									"text": "prepend set"
								}
							},
							{
								"box": {
									"id": "obj-337",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										95.0,
										600.0,
										145.0,
										22.0
									],
									"text": "prepend /map/slot1"
								}
							},
							{
								"box": {
									"id": "obj-338",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										95.0,
										626.0,
										65.0,
										22.0
									],
									"text": "s osc-hub"
								}
							},
							{
								"box": {
									"id": "obj-339",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										177.0,
										12.0,
										150.0,
										19.0
									],
									"text": "SLOT 2",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-340",
									"maxclass": "umenu",
									"items": [
										"sm_A_angmag",
										"sm_A_accmag",
										"sm_A_jerk",
										"sm_A_still",
										"sm_A_angx",
										"sm_A_angy",
										"sm_A_angz",
										"sm_A_dirx",
										"sm_A_diry",
										"sm_A_dirz",
										"sm_A_az",
										"sm_B_angmag",
										"sm_B_accmag",
										"sm_B_jerk",
										"sm_B_still",
										"sm_B_angx",
										"sm_B_angy",
										"sm_B_angz",
										"sm_B_dirx",
										"sm_B_diry",
										"sm_B_dirz",
										"sm_B_az",
										"sm_C_angmag",
										"sm_C_accmag",
										"sm_C_jerk",
										"sm_C_still",
										"sm_C_angx",
										"sm_C_angy",
										"sm_C_angz",
										"sm_C_dirx",
										"sm_C_diry",
										"sm_C_dirz",
										"sm_C_az",
										"sm_AB_pitch",
										"sm_AB_roll",
										"sm_AB_yaw",
										"sm_AC_pitch",
										"sm_AC_roll",
										"sm_AC_yaw",
										"sm_BC_pitch",
										"sm_BC_roll",
										"sm_BC_yaw"
									],
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"int",
										"",
										""
									],
									"allowdrag": 0,
									"parameter_enable": 1,
									"patching_rect": [
										175.0,
										30.0,
										155.0,
										22.0
									],
									"varname": "s2_src"
								}
							},
							{
								"box": {
									"id": "obj-341",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										175.0,
										58.0,
										155.0,
										22.0
									],
									"text": "r sm_A_angmag"
								}
							},
							{
								"box": {
									"id": "obj-342",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										175.0,
										86.0,
										85.0,
										22.0
									],
									"text": "prepend set"
								}
							},
							{
								"box": {
									"id": "obj-343",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										175.0,
										114.0,
										45.0,
										19.0
									],
									"text": "in min"
								}
							},
							{
								"box": {
									"id": "obj-344",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										235.0,
										114.0,
										45.0,
										19.0
									],
									"text": "in max"
								}
							},
							{
								"box": {
									"id": "obj-345",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										175.0,
										130.0,
										55.0,
										22.0
									],
									"value": 0.0,
									"varname": "s2_in_lo"
								}
							},
							{
								"box": {
									"id": "obj-346",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										235.0,
										130.0,
										55.0,
										22.0
									],
									"value": 1.0,
									"varname": "s2_in_hi"
								}
							},
							{
								"box": {
									"id": "obj-347",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										175.0,
										156.0,
										195.0,
										22.0
									],
									"text": "expr ($f1 - $f2) / ($f3 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-348",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										175.0,
										182.0,
										240.0,
										22.0
									],
									"text": "expr $f1 < 0.0 ? 0.0 : $f1 > 1.0 ? 1.0 : $f1"
								}
							},
							{
								"box": {
									"id": "obj-349",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										175.0,
										208.0,
										60.0,
										19.0
									],
									"text": "curve"
								}
							},
							{
								"box": {
									"id": "obj-350",
									"maxclass": "umenu",
									"items": [
										"0-linear",
										"1-exp (x^2)",
										"2-log",
										"3-S-curve"
									],
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"int",
										"",
										""
									],
									"allowdrag": 0,
									"parameter_enable": 1,
									"patching_rect": [
										175.0,
										224.0,
										155.0,
										22.0
									],
									"varname": "s2_curve"
								}
							},
							{
								"box": {
									"id": "obj-351",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										335.0,
										224.0,
										30.0,
										22.0
									],
									"text": "+ 1"
								}
							},
							{
								"box": {
									"id": "obj-352",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 4,
									"outlettype": [
										"",
										"",
										"",
										""
									],
									"patching_rect": [
										335.0,
										250.0,
										50.0,
										22.0
									],
									"text": "gate 4"
								}
							},
							{
								"box": {
									"id": "obj-353",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										175.0,
										282.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-354",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										220.0,
										282.0,
										110.0,
										22.0
									],
									"text": "expr pow($f1, 2.0)"
								}
							},
							{
								"box": {
									"id": "obj-355",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										175.0,
										308.0,
										210.0,
										22.0
									],
									"text": "expr (pow(100.0, $f1) - 1.0) * 0.010101"
								}
							},
							{
								"box": {
									"id": "obj-356",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										175.0,
										334.0,
										200.0,
										22.0
									],
									"text": "expr 3.0*$f1*$f1 - 2.0*$f1*$f1*$f1"
								}
							},
							{
								"box": {
									"id": "obj-357",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										175.0,
										360.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-358",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										175.0,
										386.0,
										50.0,
										19.0
									],
									"text": "out min"
								}
							},
							{
								"box": {
									"id": "obj-359",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										240.0,
										386.0,
										50.0,
										19.0
									],
									"text": "out max"
								}
							},
							{
								"box": {
									"id": "obj-360",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										175.0,
										402.0,
										55.0,
										22.0
									],
									"value": 0.0,
									"varname": "s2_out_lo"
								}
							},
							{
								"box": {
									"id": "obj-361",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										240.0,
										402.0,
										55.0,
										22.0
									],
									"value": 1.0,
									"varname": "s2_out_hi"
								}
							},
							{
								"box": {
									"id": "obj-362",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										175.0,
										428.0,
										190.0,
										22.0
									],
									"text": "expr $f2 + $f1 * ($f3 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-363",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										175.0,
										454.0,
										55.0,
										19.0
									],
									"text": "smooth"
								}
							},
							{
								"box": {
									"id": "obj-364",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										230.0,
										454.0,
										50.0,
										22.0
									],
									"minimum": 0.0,
									"maximum": 5000.0,
									"value": 0.0,
									"varname": "s2_smooth"
								}
							},
							{
								"box": {
									"id": "obj-365",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										175.0,
										470.0,
										65.0,
										22.0
									],
									"text": "slide 0 0"
								}
							},
							{
								"box": {
									"id": "obj-366",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										175.0,
										496.0,
										25.0,
										19.0
									],
									"text": "inv"
								}
							},
							{
								"box": {
									"id": "obj-367",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										203.0,
										496.0,
										24.0,
										24.0
									],
									"varname": "s2_invert"
								}
							},
							{
								"box": {
									"id": "obj-368",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										175.0,
										522.0,
										200.0,
										22.0
									],
									"text": "expr $i2 ? $f4 + $f3 - $f1 : $f1"
								}
							},
							{
								"box": {
									"id": "obj-369",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										285.0,
										496.0,
										35.0,
										19.0
									],
									"text": "mute"
								}
							},
							{
								"box": {
									"id": "obj-370",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										323.0,
										496.0,
										24.0,
										24.0
									],
									"varname": "s2_mute"
								}
							},
							{
								"box": {
									"id": "obj-371",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										175.0,
										548.0,
										140.0,
										22.0
									],
									"text": "expr (1 - $i2) * $f1"
								}
							},
							{
								"box": {
									"id": "obj-372",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										175.0,
										574.0,
										65.0,
										19.0
									],
									"text": "OSC addr:"
								}
							},
							{
								"box": {
									"id": "obj-373",
									"maxclass": "textedit",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"parameter_enable": 1,
									"patching_rect": [
										243.0,
										574.0,
										87.0,
										22.0
									],
									"varname": "s2_addr",
									"text": "/map/slot2"
								}
							},
							{
								"box": {
									"id": "obj-374",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										175.0,
										600.0,
										80.0,
										22.0
									],
									"text": "prepend set"
								}
							},
							{
								"box": {
									"id": "obj-375",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										260.0,
										600.0,
										145.0,
										22.0
									],
									"text": "prepend /map/slot2"
								}
							},
							{
								"box": {
									"id": "obj-376",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										260.0,
										626.0,
										65.0,
										22.0
									],
									"text": "s osc-hub"
								}
							},
							{
								"box": {
									"id": "obj-377",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										342.0,
										12.0,
										150.0,
										19.0
									],
									"text": "SLOT 3",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-378",
									"maxclass": "umenu",
									"items": [
										"sm_A_angmag",
										"sm_A_accmag",
										"sm_A_jerk",
										"sm_A_still",
										"sm_A_angx",
										"sm_A_angy",
										"sm_A_angz",
										"sm_A_dirx",
										"sm_A_diry",
										"sm_A_dirz",
										"sm_A_az",
										"sm_B_angmag",
										"sm_B_accmag",
										"sm_B_jerk",
										"sm_B_still",
										"sm_B_angx",
										"sm_B_angy",
										"sm_B_angz",
										"sm_B_dirx",
										"sm_B_diry",
										"sm_B_dirz",
										"sm_B_az",
										"sm_C_angmag",
										"sm_C_accmag",
										"sm_C_jerk",
										"sm_C_still",
										"sm_C_angx",
										"sm_C_angy",
										"sm_C_angz",
										"sm_C_dirx",
										"sm_C_diry",
										"sm_C_dirz",
										"sm_C_az",
										"sm_AB_pitch",
										"sm_AB_roll",
										"sm_AB_yaw",
										"sm_AC_pitch",
										"sm_AC_roll",
										"sm_AC_yaw",
										"sm_BC_pitch",
										"sm_BC_roll",
										"sm_BC_yaw"
									],
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"int",
										"",
										""
									],
									"allowdrag": 0,
									"parameter_enable": 1,
									"patching_rect": [
										340.0,
										30.0,
										155.0,
										22.0
									],
									"varname": "s3_src"
								}
							},
							{
								"box": {
									"id": "obj-379",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										340.0,
										58.0,
										155.0,
										22.0
									],
									"text": "r sm_A_angmag"
								}
							},
							{
								"box": {
									"id": "obj-380",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										340.0,
										86.0,
										85.0,
										22.0
									],
									"text": "prepend set"
								}
							},
							{
								"box": {
									"id": "obj-381",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										340.0,
										114.0,
										45.0,
										19.0
									],
									"text": "in min"
								}
							},
							{
								"box": {
									"id": "obj-382",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										400.0,
										114.0,
										45.0,
										19.0
									],
									"text": "in max"
								}
							},
							{
								"box": {
									"id": "obj-383",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										340.0,
										130.0,
										55.0,
										22.0
									],
									"value": 0.0,
									"varname": "s3_in_lo"
								}
							},
							{
								"box": {
									"id": "obj-384",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										400.0,
										130.0,
										55.0,
										22.0
									],
									"value": 1.0,
									"varname": "s3_in_hi"
								}
							},
							{
								"box": {
									"id": "obj-385",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										340.0,
										156.0,
										195.0,
										22.0
									],
									"text": "expr ($f1 - $f2) / ($f3 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-386",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										340.0,
										182.0,
										240.0,
										22.0
									],
									"text": "expr $f1 < 0.0 ? 0.0 : $f1 > 1.0 ? 1.0 : $f1"
								}
							},
							{
								"box": {
									"id": "obj-387",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										340.0,
										208.0,
										60.0,
										19.0
									],
									"text": "curve"
								}
							},
							{
								"box": {
									"id": "obj-388",
									"maxclass": "umenu",
									"items": [
										"0-linear",
										"1-exp (x^2)",
										"2-log",
										"3-S-curve"
									],
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"int",
										"",
										""
									],
									"allowdrag": 0,
									"parameter_enable": 1,
									"patching_rect": [
										340.0,
										224.0,
										155.0,
										22.0
									],
									"varname": "s3_curve"
								}
							},
							{
								"box": {
									"id": "obj-389",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										500.0,
										224.0,
										30.0,
										22.0
									],
									"text": "+ 1"
								}
							},
							{
								"box": {
									"id": "obj-390",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 4,
									"outlettype": [
										"",
										"",
										"",
										""
									],
									"patching_rect": [
										500.0,
										250.0,
										50.0,
										22.0
									],
									"text": "gate 4"
								}
							},
							{
								"box": {
									"id": "obj-391",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										340.0,
										282.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-392",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										385.0,
										282.0,
										110.0,
										22.0
									],
									"text": "expr pow($f1, 2.0)"
								}
							},
							{
								"box": {
									"id": "obj-393",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										340.0,
										308.0,
										210.0,
										22.0
									],
									"text": "expr (pow(100.0, $f1) - 1.0) * 0.010101"
								}
							},
							{
								"box": {
									"id": "obj-394",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										340.0,
										334.0,
										200.0,
										22.0
									],
									"text": "expr 3.0*$f1*$f1 - 2.0*$f1*$f1*$f1"
								}
							},
							{
								"box": {
									"id": "obj-395",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										340.0,
										360.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-396",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										340.0,
										386.0,
										50.0,
										19.0
									],
									"text": "out min"
								}
							},
							{
								"box": {
									"id": "obj-397",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										405.0,
										386.0,
										50.0,
										19.0
									],
									"text": "out max"
								}
							},
							{
								"box": {
									"id": "obj-398",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										340.0,
										402.0,
										55.0,
										22.0
									],
									"value": 0.0,
									"varname": "s3_out_lo"
								}
							},
							{
								"box": {
									"id": "obj-399",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										405.0,
										402.0,
										55.0,
										22.0
									],
									"value": 1.0,
									"varname": "s3_out_hi"
								}
							},
							{
								"box": {
									"id": "obj-400",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										340.0,
										428.0,
										190.0,
										22.0
									],
									"text": "expr $f2 + $f1 * ($f3 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-401",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										340.0,
										454.0,
										55.0,
										19.0
									],
									"text": "smooth"
								}
							},
							{
								"box": {
									"id": "obj-402",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										395.0,
										454.0,
										50.0,
										22.0
									],
									"minimum": 0.0,
									"maximum": 5000.0,
									"value": 0.0,
									"varname": "s3_smooth"
								}
							},
							{
								"box": {
									"id": "obj-403",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										340.0,
										470.0,
										65.0,
										22.0
									],
									"text": "slide 0 0"
								}
							},
							{
								"box": {
									"id": "obj-404",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										340.0,
										496.0,
										25.0,
										19.0
									],
									"text": "inv"
								}
							},
							{
								"box": {
									"id": "obj-405",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										368.0,
										496.0,
										24.0,
										24.0
									],
									"varname": "s3_invert"
								}
							},
							{
								"box": {
									"id": "obj-406",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										340.0,
										522.0,
										200.0,
										22.0
									],
									"text": "expr $i2 ? $f4 + $f3 - $f1 : $f1"
								}
							},
							{
								"box": {
									"id": "obj-407",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										450.0,
										496.0,
										35.0,
										19.0
									],
									"text": "mute"
								}
							},
							{
								"box": {
									"id": "obj-408",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										488.0,
										496.0,
										24.0,
										24.0
									],
									"varname": "s3_mute"
								}
							},
							{
								"box": {
									"id": "obj-409",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										340.0,
										548.0,
										140.0,
										22.0
									],
									"text": "expr (1 - $i2) * $f1"
								}
							},
							{
								"box": {
									"id": "obj-410",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										340.0,
										574.0,
										65.0,
										19.0
									],
									"text": "OSC addr:"
								}
							},
							{
								"box": {
									"id": "obj-411",
									"maxclass": "textedit",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"parameter_enable": 1,
									"patching_rect": [
										408.0,
										574.0,
										87.0,
										22.0
									],
									"varname": "s3_addr",
									"text": "/map/slot3"
								}
							},
							{
								"box": {
									"id": "obj-412",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										340.0,
										600.0,
										80.0,
										22.0
									],
									"text": "prepend set"
								}
							},
							{
								"box": {
									"id": "obj-413",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										425.0,
										600.0,
										145.0,
										22.0
									],
									"text": "prepend /map/slot3"
								}
							},
							{
								"box": {
									"id": "obj-414",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										425.0,
										626.0,
										65.0,
										22.0
									],
									"text": "s osc-hub"
								}
							},
							{
								"box": {
									"id": "obj-415",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										507.0,
										12.0,
										150.0,
										19.0
									],
									"text": "SLOT 4",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-416",
									"maxclass": "umenu",
									"items": [
										"sm_A_angmag",
										"sm_A_accmag",
										"sm_A_jerk",
										"sm_A_still",
										"sm_A_angx",
										"sm_A_angy",
										"sm_A_angz",
										"sm_A_dirx",
										"sm_A_diry",
										"sm_A_dirz",
										"sm_A_az",
										"sm_B_angmag",
										"sm_B_accmag",
										"sm_B_jerk",
										"sm_B_still",
										"sm_B_angx",
										"sm_B_angy",
										"sm_B_angz",
										"sm_B_dirx",
										"sm_B_diry",
										"sm_B_dirz",
										"sm_B_az",
										"sm_C_angmag",
										"sm_C_accmag",
										"sm_C_jerk",
										"sm_C_still",
										"sm_C_angx",
										"sm_C_angy",
										"sm_C_angz",
										"sm_C_dirx",
										"sm_C_diry",
										"sm_C_dirz",
										"sm_C_az",
										"sm_AB_pitch",
										"sm_AB_roll",
										"sm_AB_yaw",
										"sm_AC_pitch",
										"sm_AC_roll",
										"sm_AC_yaw",
										"sm_BC_pitch",
										"sm_BC_roll",
										"sm_BC_yaw"
									],
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"int",
										"",
										""
									],
									"allowdrag": 0,
									"parameter_enable": 1,
									"patching_rect": [
										505.0,
										30.0,
										155.0,
										22.0
									],
									"varname": "s4_src"
								}
							},
							{
								"box": {
									"id": "obj-417",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										505.0,
										58.0,
										155.0,
										22.0
									],
									"text": "r sm_A_angmag"
								}
							},
							{
								"box": {
									"id": "obj-418",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										505.0,
										86.0,
										85.0,
										22.0
									],
									"text": "prepend set"
								}
							},
							{
								"box": {
									"id": "obj-419",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										505.0,
										114.0,
										45.0,
										19.0
									],
									"text": "in min"
								}
							},
							{
								"box": {
									"id": "obj-420",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										565.0,
										114.0,
										45.0,
										19.0
									],
									"text": "in max"
								}
							},
							{
								"box": {
									"id": "obj-421",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										505.0,
										130.0,
										55.0,
										22.0
									],
									"value": 0.0,
									"varname": "s4_in_lo"
								}
							},
							{
								"box": {
									"id": "obj-422",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										565.0,
										130.0,
										55.0,
										22.0
									],
									"value": 1.0,
									"varname": "s4_in_hi"
								}
							},
							{
								"box": {
									"id": "obj-423",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										505.0,
										156.0,
										195.0,
										22.0
									],
									"text": "expr ($f1 - $f2) / ($f3 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-424",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										505.0,
										182.0,
										240.0,
										22.0
									],
									"text": "expr $f1 < 0.0 ? 0.0 : $f1 > 1.0 ? 1.0 : $f1"
								}
							},
							{
								"box": {
									"id": "obj-425",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										505.0,
										208.0,
										60.0,
										19.0
									],
									"text": "curve"
								}
							},
							{
								"box": {
									"id": "obj-426",
									"maxclass": "umenu",
									"items": [
										"0-linear",
										"1-exp (x^2)",
										"2-log",
										"3-S-curve"
									],
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"int",
										"",
										""
									],
									"allowdrag": 0,
									"parameter_enable": 1,
									"patching_rect": [
										505.0,
										224.0,
										155.0,
										22.0
									],
									"varname": "s4_curve"
								}
							},
							{
								"box": {
									"id": "obj-427",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										665.0,
										224.0,
										30.0,
										22.0
									],
									"text": "+ 1"
								}
							},
							{
								"box": {
									"id": "obj-428",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 4,
									"outlettype": [
										"",
										"",
										"",
										""
									],
									"patching_rect": [
										665.0,
										250.0,
										50.0,
										22.0
									],
									"text": "gate 4"
								}
							},
							{
								"box": {
									"id": "obj-429",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										505.0,
										282.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-430",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										550.0,
										282.0,
										110.0,
										22.0
									],
									"text": "expr pow($f1, 2.0)"
								}
							},
							{
								"box": {
									"id": "obj-431",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										505.0,
										308.0,
										210.0,
										22.0
									],
									"text": "expr (pow(100.0, $f1) - 1.0) * 0.010101"
								}
							},
							{
								"box": {
									"id": "obj-432",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										505.0,
										334.0,
										200.0,
										22.0
									],
									"text": "expr 3.0*$f1*$f1 - 2.0*$f1*$f1*$f1"
								}
							},
							{
								"box": {
									"id": "obj-433",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										505.0,
										360.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-434",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										505.0,
										386.0,
										50.0,
										19.0
									],
									"text": "out min"
								}
							},
							{
								"box": {
									"id": "obj-435",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										570.0,
										386.0,
										50.0,
										19.0
									],
									"text": "out max"
								}
							},
							{
								"box": {
									"id": "obj-436",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										505.0,
										402.0,
										55.0,
										22.0
									],
									"value": 0.0,
									"varname": "s4_out_lo"
								}
							},
							{
								"box": {
									"id": "obj-437",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										570.0,
										402.0,
										55.0,
										22.0
									],
									"value": 1.0,
									"varname": "s4_out_hi"
								}
							},
							{
								"box": {
									"id": "obj-438",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										505.0,
										428.0,
										190.0,
										22.0
									],
									"text": "expr $f2 + $f1 * ($f3 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-439",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										505.0,
										454.0,
										55.0,
										19.0
									],
									"text": "smooth"
								}
							},
							{
								"box": {
									"id": "obj-440",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										560.0,
										454.0,
										50.0,
										22.0
									],
									"minimum": 0.0,
									"maximum": 5000.0,
									"value": 0.0,
									"varname": "s4_smooth"
								}
							},
							{
								"box": {
									"id": "obj-441",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										505.0,
										470.0,
										65.0,
										22.0
									],
									"text": "slide 0 0"
								}
							},
							{
								"box": {
									"id": "obj-442",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										505.0,
										496.0,
										25.0,
										19.0
									],
									"text": "inv"
								}
							},
							{
								"box": {
									"id": "obj-443",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										533.0,
										496.0,
										24.0,
										24.0
									],
									"varname": "s4_invert"
								}
							},
							{
								"box": {
									"id": "obj-444",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										505.0,
										522.0,
										200.0,
										22.0
									],
									"text": "expr $i2 ? $f4 + $f3 - $f1 : $f1"
								}
							},
							{
								"box": {
									"id": "obj-445",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										615.0,
										496.0,
										35.0,
										19.0
									],
									"text": "mute"
								}
							},
							{
								"box": {
									"id": "obj-446",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										653.0,
										496.0,
										24.0,
										24.0
									],
									"varname": "s4_mute"
								}
							},
							{
								"box": {
									"id": "obj-447",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										505.0,
										548.0,
										140.0,
										22.0
									],
									"text": "expr (1 - $i2) * $f1"
								}
							},
							{
								"box": {
									"id": "obj-448",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										505.0,
										574.0,
										65.0,
										19.0
									],
									"text": "OSC addr:"
								}
							},
							{
								"box": {
									"id": "obj-449",
									"maxclass": "textedit",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"parameter_enable": 1,
									"patching_rect": [
										573.0,
										574.0,
										87.0,
										22.0
									],
									"varname": "s4_addr",
									"text": "/map/slot4"
								}
							},
							{
								"box": {
									"id": "obj-450",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										505.0,
										600.0,
										80.0,
										22.0
									],
									"text": "prepend set"
								}
							},
							{
								"box": {
									"id": "obj-451",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										590.0,
										600.0,
										145.0,
										22.0
									],
									"text": "prepend /map/slot4"
								}
							},
							{
								"box": {
									"id": "obj-452",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										590.0,
										626.0,
										65.0,
										22.0
									],
									"text": "s osc-hub"
								}
							},
							{
								"box": {
									"id": "obj-453",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										672.0,
										12.0,
										150.0,
										19.0
									],
									"text": "SLOT 5",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-454",
									"maxclass": "umenu",
									"items": [
										"sm_A_angmag",
										"sm_A_accmag",
										"sm_A_jerk",
										"sm_A_still",
										"sm_A_angx",
										"sm_A_angy",
										"sm_A_angz",
										"sm_A_dirx",
										"sm_A_diry",
										"sm_A_dirz",
										"sm_A_az",
										"sm_B_angmag",
										"sm_B_accmag",
										"sm_B_jerk",
										"sm_B_still",
										"sm_B_angx",
										"sm_B_angy",
										"sm_B_angz",
										"sm_B_dirx",
										"sm_B_diry",
										"sm_B_dirz",
										"sm_B_az",
										"sm_C_angmag",
										"sm_C_accmag",
										"sm_C_jerk",
										"sm_C_still",
										"sm_C_angx",
										"sm_C_angy",
										"sm_C_angz",
										"sm_C_dirx",
										"sm_C_diry",
										"sm_C_dirz",
										"sm_C_az",
										"sm_AB_pitch",
										"sm_AB_roll",
										"sm_AB_yaw",
										"sm_AC_pitch",
										"sm_AC_roll",
										"sm_AC_yaw",
										"sm_BC_pitch",
										"sm_BC_roll",
										"sm_BC_yaw"
									],
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"int",
										"",
										""
									],
									"allowdrag": 0,
									"parameter_enable": 1,
									"patching_rect": [
										670.0,
										30.0,
										155.0,
										22.0
									],
									"varname": "s5_src"
								}
							},
							{
								"box": {
									"id": "obj-455",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										670.0,
										58.0,
										155.0,
										22.0
									],
									"text": "r sm_A_angmag"
								}
							},
							{
								"box": {
									"id": "obj-456",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										670.0,
										86.0,
										85.0,
										22.0
									],
									"text": "prepend set"
								}
							},
							{
								"box": {
									"id": "obj-457",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										670.0,
										114.0,
										45.0,
										19.0
									],
									"text": "in min"
								}
							},
							{
								"box": {
									"id": "obj-458",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										730.0,
										114.0,
										45.0,
										19.0
									],
									"text": "in max"
								}
							},
							{
								"box": {
									"id": "obj-459",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										670.0,
										130.0,
										55.0,
										22.0
									],
									"value": 0.0,
									"varname": "s5_in_lo"
								}
							},
							{
								"box": {
									"id": "obj-460",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										730.0,
										130.0,
										55.0,
										22.0
									],
									"value": 1.0,
									"varname": "s5_in_hi"
								}
							},
							{
								"box": {
									"id": "obj-461",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										670.0,
										156.0,
										195.0,
										22.0
									],
									"text": "expr ($f1 - $f2) / ($f3 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-462",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										670.0,
										182.0,
										240.0,
										22.0
									],
									"text": "expr $f1 < 0.0 ? 0.0 : $f1 > 1.0 ? 1.0 : $f1"
								}
							},
							{
								"box": {
									"id": "obj-463",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										670.0,
										208.0,
										60.0,
										19.0
									],
									"text": "curve"
								}
							},
							{
								"box": {
									"id": "obj-464",
									"maxclass": "umenu",
									"items": [
										"0-linear",
										"1-exp (x^2)",
										"2-log",
										"3-S-curve"
									],
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"int",
										"",
										""
									],
									"allowdrag": 0,
									"parameter_enable": 1,
									"patching_rect": [
										670.0,
										224.0,
										155.0,
										22.0
									],
									"varname": "s5_curve"
								}
							},
							{
								"box": {
									"id": "obj-465",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										830.0,
										224.0,
										30.0,
										22.0
									],
									"text": "+ 1"
								}
							},
							{
								"box": {
									"id": "obj-466",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 4,
									"outlettype": [
										"",
										"",
										"",
										""
									],
									"patching_rect": [
										830.0,
										250.0,
										50.0,
										22.0
									],
									"text": "gate 4"
								}
							},
							{
								"box": {
									"id": "obj-467",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										670.0,
										282.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-468",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										715.0,
										282.0,
										110.0,
										22.0
									],
									"text": "expr pow($f1, 2.0)"
								}
							},
							{
								"box": {
									"id": "obj-469",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										670.0,
										308.0,
										210.0,
										22.0
									],
									"text": "expr (pow(100.0, $f1) - 1.0) * 0.010101"
								}
							},
							{
								"box": {
									"id": "obj-470",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										670.0,
										334.0,
										200.0,
										22.0
									],
									"text": "expr 3.0*$f1*$f1 - 2.0*$f1*$f1*$f1"
								}
							},
							{
								"box": {
									"id": "obj-471",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										670.0,
										360.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-472",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										670.0,
										386.0,
										50.0,
										19.0
									],
									"text": "out min"
								}
							},
							{
								"box": {
									"id": "obj-473",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										735.0,
										386.0,
										50.0,
										19.0
									],
									"text": "out max"
								}
							},
							{
								"box": {
									"id": "obj-474",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										670.0,
										402.0,
										55.0,
										22.0
									],
									"value": 0.0,
									"varname": "s5_out_lo"
								}
							},
							{
								"box": {
									"id": "obj-475",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										735.0,
										402.0,
										55.0,
										22.0
									],
									"value": 1.0,
									"varname": "s5_out_hi"
								}
							},
							{
								"box": {
									"id": "obj-476",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										670.0,
										428.0,
										190.0,
										22.0
									],
									"text": "expr $f2 + $f1 * ($f3 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-477",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										670.0,
										454.0,
										55.0,
										19.0
									],
									"text": "smooth"
								}
							},
							{
								"box": {
									"id": "obj-478",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										725.0,
										454.0,
										50.0,
										22.0
									],
									"minimum": 0.0,
									"maximum": 5000.0,
									"value": 0.0,
									"varname": "s5_smooth"
								}
							},
							{
								"box": {
									"id": "obj-479",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										670.0,
										470.0,
										65.0,
										22.0
									],
									"text": "slide 0 0"
								}
							},
							{
								"box": {
									"id": "obj-480",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										670.0,
										496.0,
										25.0,
										19.0
									],
									"text": "inv"
								}
							},
							{
								"box": {
									"id": "obj-481",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										698.0,
										496.0,
										24.0,
										24.0
									],
									"varname": "s5_invert"
								}
							},
							{
								"box": {
									"id": "obj-482",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										670.0,
										522.0,
										200.0,
										22.0
									],
									"text": "expr $i2 ? $f4 + $f3 - $f1 : $f1"
								}
							},
							{
								"box": {
									"id": "obj-483",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										780.0,
										496.0,
										35.0,
										19.0
									],
									"text": "mute"
								}
							},
							{
								"box": {
									"id": "obj-484",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										818.0,
										496.0,
										24.0,
										24.0
									],
									"varname": "s5_mute"
								}
							},
							{
								"box": {
									"id": "obj-485",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										670.0,
										548.0,
										140.0,
										22.0
									],
									"text": "expr (1 - $i2) * $f1"
								}
							},
							{
								"box": {
									"id": "obj-486",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										670.0,
										574.0,
										65.0,
										19.0
									],
									"text": "OSC addr:"
								}
							},
							{
								"box": {
									"id": "obj-487",
									"maxclass": "textedit",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"parameter_enable": 1,
									"patching_rect": [
										738.0,
										574.0,
										87.0,
										22.0
									],
									"varname": "s5_addr",
									"text": "/map/slot5"
								}
							},
							{
								"box": {
									"id": "obj-488",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										670.0,
										600.0,
										80.0,
										22.0
									],
									"text": "prepend set"
								}
							},
							{
								"box": {
									"id": "obj-489",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										755.0,
										600.0,
										145.0,
										22.0
									],
									"text": "prepend /map/slot5"
								}
							},
							{
								"box": {
									"id": "obj-490",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										755.0,
										626.0,
										65.0,
										22.0
									],
									"text": "s osc-hub"
								}
							},
							{
								"box": {
									"id": "obj-491",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										837.0,
										12.0,
										150.0,
										19.0
									],
									"text": "SLOT 6",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-492",
									"maxclass": "umenu",
									"items": [
										"sm_A_angmag",
										"sm_A_accmag",
										"sm_A_jerk",
										"sm_A_still",
										"sm_A_angx",
										"sm_A_angy",
										"sm_A_angz",
										"sm_A_dirx",
										"sm_A_diry",
										"sm_A_dirz",
										"sm_A_az",
										"sm_B_angmag",
										"sm_B_accmag",
										"sm_B_jerk",
										"sm_B_still",
										"sm_B_angx",
										"sm_B_angy",
										"sm_B_angz",
										"sm_B_dirx",
										"sm_B_diry",
										"sm_B_dirz",
										"sm_B_az",
										"sm_C_angmag",
										"sm_C_accmag",
										"sm_C_jerk",
										"sm_C_still",
										"sm_C_angx",
										"sm_C_angy",
										"sm_C_angz",
										"sm_C_dirx",
										"sm_C_diry",
										"sm_C_dirz",
										"sm_C_az",
										"sm_AB_pitch",
										"sm_AB_roll",
										"sm_AB_yaw",
										"sm_AC_pitch",
										"sm_AC_roll",
										"sm_AC_yaw",
										"sm_BC_pitch",
										"sm_BC_roll",
										"sm_BC_yaw"
									],
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"int",
										"",
										""
									],
									"allowdrag": 0,
									"parameter_enable": 1,
									"patching_rect": [
										835.0,
										30.0,
										155.0,
										22.0
									],
									"varname": "s6_src"
								}
							},
							{
								"box": {
									"id": "obj-493",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										835.0,
										58.0,
										155.0,
										22.0
									],
									"text": "r sm_A_angmag"
								}
							},
							{
								"box": {
									"id": "obj-494",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										835.0,
										86.0,
										85.0,
										22.0
									],
									"text": "prepend set"
								}
							},
							{
								"box": {
									"id": "obj-495",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										835.0,
										114.0,
										45.0,
										19.0
									],
									"text": "in min"
								}
							},
							{
								"box": {
									"id": "obj-496",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										895.0,
										114.0,
										45.0,
										19.0
									],
									"text": "in max"
								}
							},
							{
								"box": {
									"id": "obj-497",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										835.0,
										130.0,
										55.0,
										22.0
									],
									"value": 0.0,
									"varname": "s6_in_lo"
								}
							},
							{
								"box": {
									"id": "obj-498",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										895.0,
										130.0,
										55.0,
										22.0
									],
									"value": 1.0,
									"varname": "s6_in_hi"
								}
							},
							{
								"box": {
									"id": "obj-499",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										835.0,
										156.0,
										195.0,
										22.0
									],
									"text": "expr ($f1 - $f2) / ($f3 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-500",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										835.0,
										182.0,
										240.0,
										22.0
									],
									"text": "expr $f1 < 0.0 ? 0.0 : $f1 > 1.0 ? 1.0 : $f1"
								}
							},
							{
								"box": {
									"id": "obj-501",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										835.0,
										208.0,
										60.0,
										19.0
									],
									"text": "curve"
								}
							},
							{
								"box": {
									"id": "obj-502",
									"maxclass": "umenu",
									"items": [
										"0-linear",
										"1-exp (x^2)",
										"2-log",
										"3-S-curve"
									],
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"int",
										"",
										""
									],
									"allowdrag": 0,
									"parameter_enable": 1,
									"patching_rect": [
										835.0,
										224.0,
										155.0,
										22.0
									],
									"varname": "s6_curve"
								}
							},
							{
								"box": {
									"id": "obj-503",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										995.0,
										224.0,
										30.0,
										22.0
									],
									"text": "+ 1"
								}
							},
							{
								"box": {
									"id": "obj-504",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 4,
									"outlettype": [
										"",
										"",
										"",
										""
									],
									"patching_rect": [
										995.0,
										250.0,
										50.0,
										22.0
									],
									"text": "gate 4"
								}
							},
							{
								"box": {
									"id": "obj-505",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										835.0,
										282.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-506",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										880.0,
										282.0,
										110.0,
										22.0
									],
									"text": "expr pow($f1, 2.0)"
								}
							},
							{
								"box": {
									"id": "obj-507",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										835.0,
										308.0,
										210.0,
										22.0
									],
									"text": "expr (pow(100.0, $f1) - 1.0) * 0.010101"
								}
							},
							{
								"box": {
									"id": "obj-508",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										835.0,
										334.0,
										200.0,
										22.0
									],
									"text": "expr 3.0*$f1*$f1 - 2.0*$f1*$f1*$f1"
								}
							},
							{
								"box": {
									"id": "obj-509",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										835.0,
										360.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-510",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										835.0,
										386.0,
										50.0,
										19.0
									],
									"text": "out min"
								}
							},
							{
								"box": {
									"id": "obj-511",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										900.0,
										386.0,
										50.0,
										19.0
									],
									"text": "out max"
								}
							},
							{
								"box": {
									"id": "obj-512",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										835.0,
										402.0,
										55.0,
										22.0
									],
									"value": 0.0,
									"varname": "s6_out_lo"
								}
							},
							{
								"box": {
									"id": "obj-513",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										900.0,
										402.0,
										55.0,
										22.0
									],
									"value": 1.0,
									"varname": "s6_out_hi"
								}
							},
							{
								"box": {
									"id": "obj-514",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										835.0,
										428.0,
										190.0,
										22.0
									],
									"text": "expr $f2 + $f1 * ($f3 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-515",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										835.0,
										454.0,
										55.0,
										19.0
									],
									"text": "smooth"
								}
							},
							{
								"box": {
									"id": "obj-516",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										890.0,
										454.0,
										50.0,
										22.0
									],
									"minimum": 0.0,
									"maximum": 5000.0,
									"value": 0.0,
									"varname": "s6_smooth"
								}
							},
							{
								"box": {
									"id": "obj-517",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										835.0,
										470.0,
										65.0,
										22.0
									],
									"text": "slide 0 0"
								}
							},
							{
								"box": {
									"id": "obj-518",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										835.0,
										496.0,
										25.0,
										19.0
									],
									"text": "inv"
								}
							},
							{
								"box": {
									"id": "obj-519",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										863.0,
										496.0,
										24.0,
										24.0
									],
									"varname": "s6_invert"
								}
							},
							{
								"box": {
									"id": "obj-520",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										835.0,
										522.0,
										200.0,
										22.0
									],
									"text": "expr $i2 ? $f4 + $f3 - $f1 : $f1"
								}
							},
							{
								"box": {
									"id": "obj-521",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										945.0,
										496.0,
										35.0,
										19.0
									],
									"text": "mute"
								}
							},
							{
								"box": {
									"id": "obj-522",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										983.0,
										496.0,
										24.0,
										24.0
									],
									"varname": "s6_mute"
								}
							},
							{
								"box": {
									"id": "obj-523",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										835.0,
										548.0,
										140.0,
										22.0
									],
									"text": "expr (1 - $i2) * $f1"
								}
							},
							{
								"box": {
									"id": "obj-524",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										835.0,
										574.0,
										65.0,
										19.0
									],
									"text": "OSC addr:"
								}
							},
							{
								"box": {
									"id": "obj-525",
									"maxclass": "textedit",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"parameter_enable": 1,
									"patching_rect": [
										903.0,
										574.0,
										87.0,
										22.0
									],
									"varname": "s6_addr",
									"text": "/map/slot6"
								}
							},
							{
								"box": {
									"id": "obj-526",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										835.0,
										600.0,
										80.0,
										22.0
									],
									"text": "prepend set"
								}
							},
							{
								"box": {
									"id": "obj-527",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										920.0,
										600.0,
										145.0,
										22.0
									],
									"text": "prepend /map/slot6"
								}
							},
							{
								"box": {
									"id": "obj-528",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										920.0,
										626.0,
										65.0,
										22.0
									],
									"text": "s osc-hub"
								}
							},
							{
								"box": {
									"id": "obj-529",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1002.0,
										12.0,
										150.0,
										19.0
									],
									"text": "SLOT 7",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-530",
									"maxclass": "umenu",
									"items": [
										"sm_A_angmag",
										"sm_A_accmag",
										"sm_A_jerk",
										"sm_A_still",
										"sm_A_angx",
										"sm_A_angy",
										"sm_A_angz",
										"sm_A_dirx",
										"sm_A_diry",
										"sm_A_dirz",
										"sm_A_az",
										"sm_B_angmag",
										"sm_B_accmag",
										"sm_B_jerk",
										"sm_B_still",
										"sm_B_angx",
										"sm_B_angy",
										"sm_B_angz",
										"sm_B_dirx",
										"sm_B_diry",
										"sm_B_dirz",
										"sm_B_az",
										"sm_C_angmag",
										"sm_C_accmag",
										"sm_C_jerk",
										"sm_C_still",
										"sm_C_angx",
										"sm_C_angy",
										"sm_C_angz",
										"sm_C_dirx",
										"sm_C_diry",
										"sm_C_dirz",
										"sm_C_az",
										"sm_AB_pitch",
										"sm_AB_roll",
										"sm_AB_yaw",
										"sm_AC_pitch",
										"sm_AC_roll",
										"sm_AC_yaw",
										"sm_BC_pitch",
										"sm_BC_roll",
										"sm_BC_yaw"
									],
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"int",
										"",
										""
									],
									"allowdrag": 0,
									"parameter_enable": 1,
									"patching_rect": [
										1000.0,
										30.0,
										155.0,
										22.0
									],
									"varname": "s7_src"
								}
							},
							{
								"box": {
									"id": "obj-531",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1000.0,
										58.0,
										155.0,
										22.0
									],
									"text": "r sm_A_angmag"
								}
							},
							{
								"box": {
									"id": "obj-532",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1000.0,
										86.0,
										85.0,
										22.0
									],
									"text": "prepend set"
								}
							},
							{
								"box": {
									"id": "obj-533",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1000.0,
										114.0,
										45.0,
										19.0
									],
									"text": "in min"
								}
							},
							{
								"box": {
									"id": "obj-534",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1060.0,
										114.0,
										45.0,
										19.0
									],
									"text": "in max"
								}
							},
							{
								"box": {
									"id": "obj-535",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										1000.0,
										130.0,
										55.0,
										22.0
									],
									"value": 0.0,
									"varname": "s7_in_lo"
								}
							},
							{
								"box": {
									"id": "obj-536",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										1060.0,
										130.0,
										55.0,
										22.0
									],
									"value": 1.0,
									"varname": "s7_in_hi"
								}
							},
							{
								"box": {
									"id": "obj-537",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1000.0,
										156.0,
										195.0,
										22.0
									],
									"text": "expr ($f1 - $f2) / ($f3 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-538",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1000.0,
										182.0,
										240.0,
										22.0
									],
									"text": "expr $f1 < 0.0 ? 0.0 : $f1 > 1.0 ? 1.0 : $f1"
								}
							},
							{
								"box": {
									"id": "obj-539",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1000.0,
										208.0,
										60.0,
										19.0
									],
									"text": "curve"
								}
							},
							{
								"box": {
									"id": "obj-540",
									"maxclass": "umenu",
									"items": [
										"0-linear",
										"1-exp (x^2)",
										"2-log",
										"3-S-curve"
									],
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"int",
										"",
										""
									],
									"allowdrag": 0,
									"parameter_enable": 1,
									"patching_rect": [
										1000.0,
										224.0,
										155.0,
										22.0
									],
									"varname": "s7_curve"
								}
							},
							{
								"box": {
									"id": "obj-541",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1160.0,
										224.0,
										30.0,
										22.0
									],
									"text": "+ 1"
								}
							},
							{
								"box": {
									"id": "obj-542",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 4,
									"outlettype": [
										"",
										"",
										"",
										""
									],
									"patching_rect": [
										1160.0,
										250.0,
										50.0,
										22.0
									],
									"text": "gate 4"
								}
							},
							{
								"box": {
									"id": "obj-543",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1000.0,
										282.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-544",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1045.0,
										282.0,
										110.0,
										22.0
									],
									"text": "expr pow($f1, 2.0)"
								}
							},
							{
								"box": {
									"id": "obj-545",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1000.0,
										308.0,
										210.0,
										22.0
									],
									"text": "expr (pow(100.0, $f1) - 1.0) * 0.010101"
								}
							},
							{
								"box": {
									"id": "obj-546",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1000.0,
										334.0,
										200.0,
										22.0
									],
									"text": "expr 3.0*$f1*$f1 - 2.0*$f1*$f1*$f1"
								}
							},
							{
								"box": {
									"id": "obj-547",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1000.0,
										360.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-548",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1000.0,
										386.0,
										50.0,
										19.0
									],
									"text": "out min"
								}
							},
							{
								"box": {
									"id": "obj-549",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1065.0,
										386.0,
										50.0,
										19.0
									],
									"text": "out max"
								}
							},
							{
								"box": {
									"id": "obj-550",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										1000.0,
										402.0,
										55.0,
										22.0
									],
									"value": 0.0,
									"varname": "s7_out_lo"
								}
							},
							{
								"box": {
									"id": "obj-551",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										1065.0,
										402.0,
										55.0,
										22.0
									],
									"value": 1.0,
									"varname": "s7_out_hi"
								}
							},
							{
								"box": {
									"id": "obj-552",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1000.0,
										428.0,
										190.0,
										22.0
									],
									"text": "expr $f2 + $f1 * ($f3 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-553",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1000.0,
										454.0,
										55.0,
										19.0
									],
									"text": "smooth"
								}
							},
							{
								"box": {
									"id": "obj-554",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										1055.0,
										454.0,
										50.0,
										22.0
									],
									"minimum": 0.0,
									"maximum": 5000.0,
									"value": 0.0,
									"varname": "s7_smooth"
								}
							},
							{
								"box": {
									"id": "obj-555",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1000.0,
										470.0,
										65.0,
										22.0
									],
									"text": "slide 0 0"
								}
							},
							{
								"box": {
									"id": "obj-556",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1000.0,
										496.0,
										25.0,
										19.0
									],
									"text": "inv"
								}
							},
							{
								"box": {
									"id": "obj-557",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										1028.0,
										496.0,
										24.0,
										24.0
									],
									"varname": "s7_invert"
								}
							},
							{
								"box": {
									"id": "obj-558",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1000.0,
										522.0,
										200.0,
										22.0
									],
									"text": "expr $i2 ? $f4 + $f3 - $f1 : $f1"
								}
							},
							{
								"box": {
									"id": "obj-559",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1110.0,
										496.0,
										35.0,
										19.0
									],
									"text": "mute"
								}
							},
							{
								"box": {
									"id": "obj-560",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										1148.0,
										496.0,
										24.0,
										24.0
									],
									"varname": "s7_mute"
								}
							},
							{
								"box": {
									"id": "obj-561",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1000.0,
										548.0,
										140.0,
										22.0
									],
									"text": "expr (1 - $i2) * $f1"
								}
							},
							{
								"box": {
									"id": "obj-562",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1000.0,
										574.0,
										65.0,
										19.0
									],
									"text": "OSC addr:"
								}
							},
							{
								"box": {
									"id": "obj-563",
									"maxclass": "textedit",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"parameter_enable": 1,
									"patching_rect": [
										1068.0,
										574.0,
										87.0,
										22.0
									],
									"varname": "s7_addr",
									"text": "/map/slot7"
								}
							},
							{
								"box": {
									"id": "obj-564",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1000.0,
										600.0,
										80.0,
										22.0
									],
									"text": "prepend set"
								}
							},
							{
								"box": {
									"id": "obj-565",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1085.0,
										600.0,
										145.0,
										22.0
									],
									"text": "prepend /map/slot7"
								}
							},
							{
								"box": {
									"id": "obj-566",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1085.0,
										626.0,
										65.0,
										22.0
									],
									"text": "s osc-hub"
								}
							},
							{
								"box": {
									"id": "obj-567",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1167.0,
										12.0,
										150.0,
										19.0
									],
									"text": "SLOT 8",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-568",
									"maxclass": "umenu",
									"items": [
										"sm_A_angmag",
										"sm_A_accmag",
										"sm_A_jerk",
										"sm_A_still",
										"sm_A_angx",
										"sm_A_angy",
										"sm_A_angz",
										"sm_A_dirx",
										"sm_A_diry",
										"sm_A_dirz",
										"sm_A_az",
										"sm_B_angmag",
										"sm_B_accmag",
										"sm_B_jerk",
										"sm_B_still",
										"sm_B_angx",
										"sm_B_angy",
										"sm_B_angz",
										"sm_B_dirx",
										"sm_B_diry",
										"sm_B_dirz",
										"sm_B_az",
										"sm_C_angmag",
										"sm_C_accmag",
										"sm_C_jerk",
										"sm_C_still",
										"sm_C_angx",
										"sm_C_angy",
										"sm_C_angz",
										"sm_C_dirx",
										"sm_C_diry",
										"sm_C_dirz",
										"sm_C_az",
										"sm_AB_pitch",
										"sm_AB_roll",
										"sm_AB_yaw",
										"sm_AC_pitch",
										"sm_AC_roll",
										"sm_AC_yaw",
										"sm_BC_pitch",
										"sm_BC_roll",
										"sm_BC_yaw"
									],
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"int",
										"",
										""
									],
									"allowdrag": 0,
									"parameter_enable": 1,
									"patching_rect": [
										1165.0,
										30.0,
										155.0,
										22.0
									],
									"varname": "s8_src"
								}
							},
							{
								"box": {
									"id": "obj-569",
									"maxclass": "newobj",
									"numinlets": 0,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1165.0,
										58.0,
										155.0,
										22.0
									],
									"text": "r sm_A_angmag"
								}
							},
							{
								"box": {
									"id": "obj-570",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1165.0,
										86.0,
										85.0,
										22.0
									],
									"text": "prepend set"
								}
							},
							{
								"box": {
									"id": "obj-571",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1165.0,
										114.0,
										45.0,
										19.0
									],
									"text": "in min"
								}
							},
							{
								"box": {
									"id": "obj-572",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1225.0,
										114.0,
										45.0,
										19.0
									],
									"text": "in max"
								}
							},
							{
								"box": {
									"id": "obj-573",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										1165.0,
										130.0,
										55.0,
										22.0
									],
									"value": 0.0,
									"varname": "s8_in_lo"
								}
							},
							{
								"box": {
									"id": "obj-574",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										1225.0,
										130.0,
										55.0,
										22.0
									],
									"value": 1.0,
									"varname": "s8_in_hi"
								}
							},
							{
								"box": {
									"id": "obj-575",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1165.0,
										156.0,
										195.0,
										22.0
									],
									"text": "expr ($f1 - $f2) / ($f3 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-576",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1165.0,
										182.0,
										240.0,
										22.0
									],
									"text": "expr $f1 < 0.0 ? 0.0 : $f1 > 1.0 ? 1.0 : $f1"
								}
							},
							{
								"box": {
									"id": "obj-577",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1165.0,
										208.0,
										60.0,
										19.0
									],
									"text": "curve"
								}
							},
							{
								"box": {
									"id": "obj-578",
									"maxclass": "umenu",
									"items": [
										"0-linear",
										"1-exp (x^2)",
										"2-log",
										"3-S-curve"
									],
									"numinlets": 1,
									"numoutlets": 3,
									"outlettype": [
										"int",
										"",
										""
									],
									"allowdrag": 0,
									"parameter_enable": 1,
									"patching_rect": [
										1165.0,
										224.0,
										155.0,
										22.0
									],
									"varname": "s8_curve"
								}
							},
							{
								"box": {
									"id": "obj-579",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1325.0,
										224.0,
										30.0,
										22.0
									],
									"text": "+ 1"
								}
							},
							{
								"box": {
									"id": "obj-580",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 4,
									"outlettype": [
										"",
										"",
										"",
										""
									],
									"patching_rect": [
										1325.0,
										250.0,
										50.0,
										22.0
									],
									"text": "gate 4"
								}
							},
							{
								"box": {
									"id": "obj-581",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1165.0,
										282.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-582",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1210.0,
										282.0,
										110.0,
										22.0
									],
									"text": "expr pow($f1, 2.0)"
								}
							},
							{
								"box": {
									"id": "obj-583",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1165.0,
										308.0,
										210.0,
										22.0
									],
									"text": "expr (pow(100.0, $f1) - 1.0) * 0.010101"
								}
							},
							{
								"box": {
									"id": "obj-584",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1165.0,
										334.0,
										200.0,
										22.0
									],
									"text": "expr 3.0*$f1*$f1 - 2.0*$f1*$f1*$f1"
								}
							},
							{
								"box": {
									"id": "obj-585",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1165.0,
										360.0,
										38.0,
										22.0
									],
									"text": "float"
								}
							},
							{
								"box": {
									"id": "obj-586",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1165.0,
										386.0,
										50.0,
										19.0
									],
									"text": "out min"
								}
							},
							{
								"box": {
									"id": "obj-587",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1230.0,
										386.0,
										50.0,
										19.0
									],
									"text": "out max"
								}
							},
							{
								"box": {
									"id": "obj-588",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										1165.0,
										402.0,
										55.0,
										22.0
									],
									"value": 0.0,
									"varname": "s8_out_lo"
								}
							},
							{
								"box": {
									"id": "obj-589",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										1230.0,
										402.0,
										55.0,
										22.0
									],
									"value": 1.0,
									"varname": "s8_out_hi"
								}
							},
							{
								"box": {
									"id": "obj-590",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1165.0,
										428.0,
										190.0,
										22.0
									],
									"text": "expr $f2 + $f1 * ($f3 - $f2)"
								}
							},
							{
								"box": {
									"id": "obj-591",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1165.0,
										454.0,
										55.0,
										19.0
									],
									"text": "smooth"
								}
							},
							{
								"box": {
									"id": "obj-592",
									"maxclass": "flonum",
									"format": 6,
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										"bang"
									],
									"parameter_enable": 1,
									"patching_rect": [
										1220.0,
										454.0,
										50.0,
										22.0
									],
									"minimum": 0.0,
									"maximum": 5000.0,
									"value": 0.0,
									"varname": "s8_smooth"
								}
							},
							{
								"box": {
									"id": "obj-593",
									"maxclass": "newobj",
									"numinlets": 3,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1165.0,
										470.0,
										65.0,
										22.0
									],
									"text": "slide 0 0"
								}
							},
							{
								"box": {
									"id": "obj-594",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1165.0,
										496.0,
										25.0,
										19.0
									],
									"text": "inv"
								}
							},
							{
								"box": {
									"id": "obj-595",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										1193.0,
										496.0,
										24.0,
										24.0
									],
									"varname": "s8_invert"
								}
							},
							{
								"box": {
									"id": "obj-596",
									"maxclass": "newobj",
									"numinlets": 4,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1165.0,
										522.0,
										200.0,
										22.0
									],
									"text": "expr $i2 ? $f4 + $f3 - $f1 : $f1"
								}
							},
							{
								"box": {
									"id": "obj-597",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1275.0,
										496.0,
										35.0,
										19.0
									],
									"text": "mute"
								}
							},
							{
								"box": {
									"id": "obj-598",
									"maxclass": "toggle",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										"int"
									],
									"parameter_enable": 1,
									"patching_rect": [
										1313.0,
										496.0,
										24.0,
										24.0
									],
									"varname": "s8_mute"
								}
							},
							{
								"box": {
									"id": "obj-599",
									"maxclass": "newobj",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1165.0,
										548.0,
										140.0,
										22.0
									],
									"text": "expr (1 - $i2) * $f1"
								}
							},
							{
								"box": {
									"id": "obj-600",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1165.0,
										574.0,
										65.0,
										19.0
									],
									"text": "OSC addr:"
								}
							},
							{
								"box": {
									"id": "obj-601",
									"maxclass": "textedit",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"parameter_enable": 1,
									"patching_rect": [
										1233.0,
										574.0,
										87.0,
										22.0
									],
									"varname": "s8_addr",
									"text": "/map/slot8"
								}
							},
							{
								"box": {
									"id": "obj-602",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1165.0,
										600.0,
										80.0,
										22.0
									],
									"text": "prepend set"
								}
							},
							{
								"box": {
									"id": "obj-603",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1250.0,
										600.0,
										145.0,
										22.0
									],
									"text": "prepend /map/slot8"
								}
							},
							{
								"box": {
									"id": "obj-604",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										1250.0,
										626.0,
										65.0,
										22.0
									],
									"text": "s osc-hub"
								}
							}
						],
						"lines": [
							{
								"patchline": {
									"source": [
										"obj-302",
										1
									],
									"destination": [
										"obj-304",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-304",
										0
									],
									"destination": [
										"obj-303",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-303",
										0
									],
									"destination": [
										"obj-309",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-307",
										0
									],
									"destination": [
										"obj-309",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-308",
										0
									],
									"destination": [
										"obj-309",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-309",
										0
									],
									"destination": [
										"obj-310",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-312",
										0
									],
									"destination": [
										"obj-313",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-313",
										0
									],
									"destination": [
										"obj-314",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-310",
										0
									],
									"destination": [
										"obj-314",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-314",
										0
									],
									"destination": [
										"obj-315",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-314",
										1
									],
									"destination": [
										"obj-316",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-314",
										2
									],
									"destination": [
										"obj-317",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-314",
										3
									],
									"destination": [
										"obj-318",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-315",
										0
									],
									"destination": [
										"obj-319",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-316",
										0
									],
									"destination": [
										"obj-319",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-317",
										0
									],
									"destination": [
										"obj-319",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-318",
										0
									],
									"destination": [
										"obj-319",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-319",
										0
									],
									"destination": [
										"obj-324",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-322",
										0
									],
									"destination": [
										"obj-324",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-323",
										0
									],
									"destination": [
										"obj-324",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-324",
										0
									],
									"destination": [
										"obj-327",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-326",
										0
									],
									"destination": [
										"obj-327",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-326",
										0
									],
									"destination": [
										"obj-327",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-327",
										0
									],
									"destination": [
										"obj-330",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-322",
										0
									],
									"destination": [
										"obj-330",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-323",
										0
									],
									"destination": [
										"obj-330",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-329",
										0
									],
									"destination": [
										"obj-330",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-330",
										0
									],
									"destination": [
										"obj-333",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-332",
										0
									],
									"destination": [
										"obj-333",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-335",
										0
									],
									"destination": [
										"obj-336",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-336",
										0
									],
									"destination": [
										"obj-337",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-333",
										0
									],
									"destination": [
										"obj-337",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-337",
										0
									],
									"destination": [
										"obj-338",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-340",
										1
									],
									"destination": [
										"obj-342",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-342",
										0
									],
									"destination": [
										"obj-341",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-341",
										0
									],
									"destination": [
										"obj-347",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-345",
										0
									],
									"destination": [
										"obj-347",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-346",
										0
									],
									"destination": [
										"obj-347",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-347",
										0
									],
									"destination": [
										"obj-348",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-350",
										0
									],
									"destination": [
										"obj-351",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-351",
										0
									],
									"destination": [
										"obj-352",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-348",
										0
									],
									"destination": [
										"obj-352",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-352",
										0
									],
									"destination": [
										"obj-353",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-352",
										1
									],
									"destination": [
										"obj-354",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-352",
										2
									],
									"destination": [
										"obj-355",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-352",
										3
									],
									"destination": [
										"obj-356",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-353",
										0
									],
									"destination": [
										"obj-357",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-354",
										0
									],
									"destination": [
										"obj-357",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-355",
										0
									],
									"destination": [
										"obj-357",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-356",
										0
									],
									"destination": [
										"obj-357",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-357",
										0
									],
									"destination": [
										"obj-362",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-360",
										0
									],
									"destination": [
										"obj-362",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-361",
										0
									],
									"destination": [
										"obj-362",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-362",
										0
									],
									"destination": [
										"obj-365",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-364",
										0
									],
									"destination": [
										"obj-365",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-364",
										0
									],
									"destination": [
										"obj-365",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-365",
										0
									],
									"destination": [
										"obj-368",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-360",
										0
									],
									"destination": [
										"obj-368",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-361",
										0
									],
									"destination": [
										"obj-368",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-367",
										0
									],
									"destination": [
										"obj-368",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-368",
										0
									],
									"destination": [
										"obj-371",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-370",
										0
									],
									"destination": [
										"obj-371",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-373",
										0
									],
									"destination": [
										"obj-374",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-374",
										0
									],
									"destination": [
										"obj-375",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-371",
										0
									],
									"destination": [
										"obj-375",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-375",
										0
									],
									"destination": [
										"obj-376",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-378",
										1
									],
									"destination": [
										"obj-380",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-380",
										0
									],
									"destination": [
										"obj-379",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-379",
										0
									],
									"destination": [
										"obj-385",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-383",
										0
									],
									"destination": [
										"obj-385",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-384",
										0
									],
									"destination": [
										"obj-385",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-385",
										0
									],
									"destination": [
										"obj-386",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-388",
										0
									],
									"destination": [
										"obj-389",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-389",
										0
									],
									"destination": [
										"obj-390",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-386",
										0
									],
									"destination": [
										"obj-390",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-390",
										0
									],
									"destination": [
										"obj-391",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-390",
										1
									],
									"destination": [
										"obj-392",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-390",
										2
									],
									"destination": [
										"obj-393",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-390",
										3
									],
									"destination": [
										"obj-394",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-391",
										0
									],
									"destination": [
										"obj-395",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-392",
										0
									],
									"destination": [
										"obj-395",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-393",
										0
									],
									"destination": [
										"obj-395",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-394",
										0
									],
									"destination": [
										"obj-395",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-395",
										0
									],
									"destination": [
										"obj-400",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-398",
										0
									],
									"destination": [
										"obj-400",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-399",
										0
									],
									"destination": [
										"obj-400",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-400",
										0
									],
									"destination": [
										"obj-403",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-402",
										0
									],
									"destination": [
										"obj-403",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-402",
										0
									],
									"destination": [
										"obj-403",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-403",
										0
									],
									"destination": [
										"obj-406",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-398",
										0
									],
									"destination": [
										"obj-406",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-399",
										0
									],
									"destination": [
										"obj-406",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-405",
										0
									],
									"destination": [
										"obj-406",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-406",
										0
									],
									"destination": [
										"obj-409",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-408",
										0
									],
									"destination": [
										"obj-409",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-411",
										0
									],
									"destination": [
										"obj-412",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-412",
										0
									],
									"destination": [
										"obj-413",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-409",
										0
									],
									"destination": [
										"obj-413",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-413",
										0
									],
									"destination": [
										"obj-414",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-416",
										1
									],
									"destination": [
										"obj-418",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-418",
										0
									],
									"destination": [
										"obj-417",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-417",
										0
									],
									"destination": [
										"obj-423",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-421",
										0
									],
									"destination": [
										"obj-423",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-422",
										0
									],
									"destination": [
										"obj-423",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-423",
										0
									],
									"destination": [
										"obj-424",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-426",
										0
									],
									"destination": [
										"obj-427",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-427",
										0
									],
									"destination": [
										"obj-428",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-424",
										0
									],
									"destination": [
										"obj-428",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-428",
										0
									],
									"destination": [
										"obj-429",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-428",
										1
									],
									"destination": [
										"obj-430",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-428",
										2
									],
									"destination": [
										"obj-431",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-428",
										3
									],
									"destination": [
										"obj-432",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-429",
										0
									],
									"destination": [
										"obj-433",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-430",
										0
									],
									"destination": [
										"obj-433",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-431",
										0
									],
									"destination": [
										"obj-433",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-432",
										0
									],
									"destination": [
										"obj-433",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-433",
										0
									],
									"destination": [
										"obj-438",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-436",
										0
									],
									"destination": [
										"obj-438",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-437",
										0
									],
									"destination": [
										"obj-438",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-438",
										0
									],
									"destination": [
										"obj-441",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-440",
										0
									],
									"destination": [
										"obj-441",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-440",
										0
									],
									"destination": [
										"obj-441",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-441",
										0
									],
									"destination": [
										"obj-444",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-436",
										0
									],
									"destination": [
										"obj-444",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-437",
										0
									],
									"destination": [
										"obj-444",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-443",
										0
									],
									"destination": [
										"obj-444",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-444",
										0
									],
									"destination": [
										"obj-447",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-446",
										0
									],
									"destination": [
										"obj-447",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-449",
										0
									],
									"destination": [
										"obj-450",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-450",
										0
									],
									"destination": [
										"obj-451",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-447",
										0
									],
									"destination": [
										"obj-451",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-451",
										0
									],
									"destination": [
										"obj-452",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-454",
										1
									],
									"destination": [
										"obj-456",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-456",
										0
									],
									"destination": [
										"obj-455",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-455",
										0
									],
									"destination": [
										"obj-461",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-459",
										0
									],
									"destination": [
										"obj-461",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-460",
										0
									],
									"destination": [
										"obj-461",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-461",
										0
									],
									"destination": [
										"obj-462",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-464",
										0
									],
									"destination": [
										"obj-465",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-465",
										0
									],
									"destination": [
										"obj-466",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-462",
										0
									],
									"destination": [
										"obj-466",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-466",
										0
									],
									"destination": [
										"obj-467",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-466",
										1
									],
									"destination": [
										"obj-468",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-466",
										2
									],
									"destination": [
										"obj-469",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-466",
										3
									],
									"destination": [
										"obj-470",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-467",
										0
									],
									"destination": [
										"obj-471",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-468",
										0
									],
									"destination": [
										"obj-471",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-469",
										0
									],
									"destination": [
										"obj-471",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-470",
										0
									],
									"destination": [
										"obj-471",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-471",
										0
									],
									"destination": [
										"obj-476",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-474",
										0
									],
									"destination": [
										"obj-476",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-475",
										0
									],
									"destination": [
										"obj-476",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-476",
										0
									],
									"destination": [
										"obj-479",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-478",
										0
									],
									"destination": [
										"obj-479",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-478",
										0
									],
									"destination": [
										"obj-479",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-479",
										0
									],
									"destination": [
										"obj-482",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-474",
										0
									],
									"destination": [
										"obj-482",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-475",
										0
									],
									"destination": [
										"obj-482",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-481",
										0
									],
									"destination": [
										"obj-482",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-482",
										0
									],
									"destination": [
										"obj-485",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-484",
										0
									],
									"destination": [
										"obj-485",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-487",
										0
									],
									"destination": [
										"obj-488",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-488",
										0
									],
									"destination": [
										"obj-489",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-485",
										0
									],
									"destination": [
										"obj-489",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-489",
										0
									],
									"destination": [
										"obj-490",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-492",
										1
									],
									"destination": [
										"obj-494",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-494",
										0
									],
									"destination": [
										"obj-493",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-493",
										0
									],
									"destination": [
										"obj-499",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-497",
										0
									],
									"destination": [
										"obj-499",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-498",
										0
									],
									"destination": [
										"obj-499",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-499",
										0
									],
									"destination": [
										"obj-500",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-502",
										0
									],
									"destination": [
										"obj-503",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-503",
										0
									],
									"destination": [
										"obj-504",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-500",
										0
									],
									"destination": [
										"obj-504",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-504",
										0
									],
									"destination": [
										"obj-505",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-504",
										1
									],
									"destination": [
										"obj-506",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-504",
										2
									],
									"destination": [
										"obj-507",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-504",
										3
									],
									"destination": [
										"obj-508",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-505",
										0
									],
									"destination": [
										"obj-509",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-506",
										0
									],
									"destination": [
										"obj-509",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-507",
										0
									],
									"destination": [
										"obj-509",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-508",
										0
									],
									"destination": [
										"obj-509",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-509",
										0
									],
									"destination": [
										"obj-514",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-512",
										0
									],
									"destination": [
										"obj-514",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-513",
										0
									],
									"destination": [
										"obj-514",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-514",
										0
									],
									"destination": [
										"obj-517",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-516",
										0
									],
									"destination": [
										"obj-517",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-516",
										0
									],
									"destination": [
										"obj-517",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-517",
										0
									],
									"destination": [
										"obj-520",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-512",
										0
									],
									"destination": [
										"obj-520",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-513",
										0
									],
									"destination": [
										"obj-520",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-519",
										0
									],
									"destination": [
										"obj-520",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-520",
										0
									],
									"destination": [
										"obj-523",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-522",
										0
									],
									"destination": [
										"obj-523",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-525",
										0
									],
									"destination": [
										"obj-526",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-526",
										0
									],
									"destination": [
										"obj-527",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-523",
										0
									],
									"destination": [
										"obj-527",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-527",
										0
									],
									"destination": [
										"obj-528",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-530",
										1
									],
									"destination": [
										"obj-532",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-532",
										0
									],
									"destination": [
										"obj-531",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-531",
										0
									],
									"destination": [
										"obj-537",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-535",
										0
									],
									"destination": [
										"obj-537",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-536",
										0
									],
									"destination": [
										"obj-537",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-537",
										0
									],
									"destination": [
										"obj-538",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-540",
										0
									],
									"destination": [
										"obj-541",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-541",
										0
									],
									"destination": [
										"obj-542",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-538",
										0
									],
									"destination": [
										"obj-542",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-542",
										0
									],
									"destination": [
										"obj-543",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-542",
										1
									],
									"destination": [
										"obj-544",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-542",
										2
									],
									"destination": [
										"obj-545",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-542",
										3
									],
									"destination": [
										"obj-546",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-543",
										0
									],
									"destination": [
										"obj-547",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-544",
										0
									],
									"destination": [
										"obj-547",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-545",
										0
									],
									"destination": [
										"obj-547",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-546",
										0
									],
									"destination": [
										"obj-547",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-547",
										0
									],
									"destination": [
										"obj-552",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-550",
										0
									],
									"destination": [
										"obj-552",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-551",
										0
									],
									"destination": [
										"obj-552",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-552",
										0
									],
									"destination": [
										"obj-555",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-554",
										0
									],
									"destination": [
										"obj-555",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-554",
										0
									],
									"destination": [
										"obj-555",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-555",
										0
									],
									"destination": [
										"obj-558",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-550",
										0
									],
									"destination": [
										"obj-558",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-551",
										0
									],
									"destination": [
										"obj-558",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-557",
										0
									],
									"destination": [
										"obj-558",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-558",
										0
									],
									"destination": [
										"obj-561",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-560",
										0
									],
									"destination": [
										"obj-561",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-563",
										0
									],
									"destination": [
										"obj-564",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-564",
										0
									],
									"destination": [
										"obj-565",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-561",
										0
									],
									"destination": [
										"obj-565",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-565",
										0
									],
									"destination": [
										"obj-566",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-568",
										1
									],
									"destination": [
										"obj-570",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-570",
										0
									],
									"destination": [
										"obj-569",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-569",
										0
									],
									"destination": [
										"obj-575",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-573",
										0
									],
									"destination": [
										"obj-575",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-574",
										0
									],
									"destination": [
										"obj-575",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-575",
										0
									],
									"destination": [
										"obj-576",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-578",
										0
									],
									"destination": [
										"obj-579",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-579",
										0
									],
									"destination": [
										"obj-580",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-576",
										0
									],
									"destination": [
										"obj-580",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-580",
										0
									],
									"destination": [
										"obj-581",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-580",
										1
									],
									"destination": [
										"obj-582",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-580",
										2
									],
									"destination": [
										"obj-583",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-580",
										3
									],
									"destination": [
										"obj-584",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-581",
										0
									],
									"destination": [
										"obj-585",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-582",
										0
									],
									"destination": [
										"obj-585",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-583",
										0
									],
									"destination": [
										"obj-585",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-584",
										0
									],
									"destination": [
										"obj-585",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-585",
										0
									],
									"destination": [
										"obj-590",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-588",
										0
									],
									"destination": [
										"obj-590",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-589",
										0
									],
									"destination": [
										"obj-590",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-590",
										0
									],
									"destination": [
										"obj-593",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-592",
										0
									],
									"destination": [
										"obj-593",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-592",
										0
									],
									"destination": [
										"obj-593",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-593",
										0
									],
									"destination": [
										"obj-596",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-588",
										0
									],
									"destination": [
										"obj-596",
										2
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-589",
										0
									],
									"destination": [
										"obj-596",
										3
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-595",
										0
									],
									"destination": [
										"obj-596",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-596",
										0
									],
									"destination": [
										"obj-599",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-598",
										0
									],
									"destination": [
										"obj-599",
										1
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-601",
										0
									],
									"destination": [
										"obj-602",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-602",
										0
									],
									"destination": [
										"obj-603",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-599",
										0
									],
									"destination": [
										"obj-603",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-603",
										0
									],
									"destination": [
										"obj-604",
										0
									]
								}
							}
						]
					}
				}
			},
			{
				"box": {
					"id": "obj-662",
					"maxclass": "newobj",
					"numinlets": 0,
					"numoutlets": 0,
					"outlettype": [],
					"patching_rect": [
						10.0,
						190.0,
						100.0,
						22.0
					],
					"text": "p presets",
					"patcher": {
						"fileversion": 1,
						"appversion": {
							"major": 9,
							"minor": 0,
							"revision": 5,
							"architecture": "x64",
							"modernui": 1
						},
						"classnamespace": "box",
						"rect": [
							0.0,
							0.0,
							1380.0,
							300.0
						],
						"gridsize": [
							15.0,
							15.0
						],
						"boxes": [
							{
								"box": {
									"id": "obj-605",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										8.0,
										400.0,
										19.0
									],
									"text": "p presets \u2014 pattrstorage for all mapping slot parameters",
									"fontface": 1,
									"fontsize": 12.0
								}
							},
							{
								"box": {
									"id": "obj-606",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										26.0,
										500.0,
										19.0
									],
									"text": "pattrstorage captures all pattr-enabled objects in sensor-mapping.maxpat"
								}
							},
							{
								"box": {
									"id": "obj-607",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 2,
									"outlettype": [
										"",
										""
									],
									"patching_rect": [
										10.0,
										55.0,
										170.0,
										22.0
									],
									"text": "pattrstorage mappingstorage"
								}
							},
							{
								"box": {
									"id": "obj-608",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										82.0,
										80.0,
										19.0
									],
									"text": "Save to disk:"
								}
							},
							{
								"box": {
									"id": "obj-609",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 0,
									"outlettype": [],
									"patching_rect": [
										95.0,
										82.0,
										70.0,
										22.0
									],
									"text": "writeagain"
								}
							},
							{
								"box": {
									"id": "obj-610",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										115.0,
										100.0,
										19.0
									],
									"text": "PRESET 1",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-611",
									"maxclass": "textedit",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"parameter_enable": 0,
									"patching_rect": [
										10.0,
										133.0,
										120.0,
										22.0
									],
									"text": "preset 1"
								}
							},
							{
								"box": {
									"id": "obj-612",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										160.0,
										65.0,
										22.0
									],
									"text": "store 1"
								}
							},
							{
								"box": {
									"id": "obj-613",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										80.0,
										160.0,
										70.0,
										22.0
									],
									"text": "recall 1"
								}
							},
							{
								"box": {
									"id": "obj-614",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										187.0,
										90.0,
										22.0
									],
									"text": "prepend name"
								}
							},
							{
								"box": {
									"id": "obj-615",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										10.0,
										213.0,
										80.0,
										22.0
									],
									"text": "prepend 1"
								}
							},
							{
								"box": {
									"id": "obj-616",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										180.0,
										115.0,
										100.0,
										19.0
									],
									"text": "PRESET 2",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-617",
									"maxclass": "textedit",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"parameter_enable": 0,
									"patching_rect": [
										180.0,
										133.0,
										120.0,
										22.0
									],
									"text": "preset 2"
								}
							},
							{
								"box": {
									"id": "obj-618",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										180.0,
										160.0,
										65.0,
										22.0
									],
									"text": "store 2"
								}
							},
							{
								"box": {
									"id": "obj-619",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										250.0,
										160.0,
										70.0,
										22.0
									],
									"text": "recall 2"
								}
							},
							{
								"box": {
									"id": "obj-620",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										180.0,
										187.0,
										90.0,
										22.0
									],
									"text": "prepend name"
								}
							},
							{
								"box": {
									"id": "obj-621",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										180.0,
										213.0,
										80.0,
										22.0
									],
									"text": "prepend 2"
								}
							},
							{
								"box": {
									"id": "obj-622",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										350.0,
										115.0,
										100.0,
										19.0
									],
									"text": "PRESET 3",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-623",
									"maxclass": "textedit",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"parameter_enable": 0,
									"patching_rect": [
										350.0,
										133.0,
										120.0,
										22.0
									],
									"text": "preset 3"
								}
							},
							{
								"box": {
									"id": "obj-624",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										350.0,
										160.0,
										65.0,
										22.0
									],
									"text": "store 3"
								}
							},
							{
								"box": {
									"id": "obj-625",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										420.0,
										160.0,
										70.0,
										22.0
									],
									"text": "recall 3"
								}
							},
							{
								"box": {
									"id": "obj-626",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										350.0,
										187.0,
										90.0,
										22.0
									],
									"text": "prepend name"
								}
							},
							{
								"box": {
									"id": "obj-627",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										350.0,
										213.0,
										80.0,
										22.0
									],
									"text": "prepend 3"
								}
							},
							{
								"box": {
									"id": "obj-628",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										520.0,
										115.0,
										100.0,
										19.0
									],
									"text": "PRESET 4",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-629",
									"maxclass": "textedit",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"parameter_enable": 0,
									"patching_rect": [
										520.0,
										133.0,
										120.0,
										22.0
									],
									"text": "preset 4"
								}
							},
							{
								"box": {
									"id": "obj-630",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										520.0,
										160.0,
										65.0,
										22.0
									],
									"text": "store 4"
								}
							},
							{
								"box": {
									"id": "obj-631",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										590.0,
										160.0,
										70.0,
										22.0
									],
									"text": "recall 4"
								}
							},
							{
								"box": {
									"id": "obj-632",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										520.0,
										187.0,
										90.0,
										22.0
									],
									"text": "prepend name"
								}
							},
							{
								"box": {
									"id": "obj-633",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										520.0,
										213.0,
										80.0,
										22.0
									],
									"text": "prepend 4"
								}
							},
							{
								"box": {
									"id": "obj-634",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										690.0,
										115.0,
										100.0,
										19.0
									],
									"text": "PRESET 5",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-635",
									"maxclass": "textedit",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"parameter_enable": 0,
									"patching_rect": [
										690.0,
										133.0,
										120.0,
										22.0
									],
									"text": "preset 5"
								}
							},
							{
								"box": {
									"id": "obj-636",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										690.0,
										160.0,
										65.0,
										22.0
									],
									"text": "store 5"
								}
							},
							{
								"box": {
									"id": "obj-637",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										760.0,
										160.0,
										70.0,
										22.0
									],
									"text": "recall 5"
								}
							},
							{
								"box": {
									"id": "obj-638",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										690.0,
										187.0,
										90.0,
										22.0
									],
									"text": "prepend name"
								}
							},
							{
								"box": {
									"id": "obj-639",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										690.0,
										213.0,
										80.0,
										22.0
									],
									"text": "prepend 5"
								}
							},
							{
								"box": {
									"id": "obj-640",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										860.0,
										115.0,
										100.0,
										19.0
									],
									"text": "PRESET 6",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-641",
									"maxclass": "textedit",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"parameter_enable": 0,
									"patching_rect": [
										860.0,
										133.0,
										120.0,
										22.0
									],
									"text": "preset 6"
								}
							},
							{
								"box": {
									"id": "obj-642",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										860.0,
										160.0,
										65.0,
										22.0
									],
									"text": "store 6"
								}
							},
							{
								"box": {
									"id": "obj-643",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										930.0,
										160.0,
										70.0,
										22.0
									],
									"text": "recall 6"
								}
							},
							{
								"box": {
									"id": "obj-644",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										860.0,
										187.0,
										90.0,
										22.0
									],
									"text": "prepend name"
								}
							},
							{
								"box": {
									"id": "obj-645",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										860.0,
										213.0,
										80.0,
										22.0
									],
									"text": "prepend 6"
								}
							},
							{
								"box": {
									"id": "obj-646",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1030.0,
										115.0,
										100.0,
										19.0
									],
									"text": "PRESET 7",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-647",
									"maxclass": "textedit",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"parameter_enable": 0,
									"patching_rect": [
										1030.0,
										133.0,
										120.0,
										22.0
									],
									"text": "preset 7"
								}
							},
							{
								"box": {
									"id": "obj-648",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1030.0,
										160.0,
										65.0,
										22.0
									],
									"text": "store 7"
								}
							},
							{
								"box": {
									"id": "obj-649",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1100.0,
										160.0,
										70.0,
										22.0
									],
									"text": "recall 7"
								}
							},
							{
								"box": {
									"id": "obj-650",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1030.0,
										187.0,
										90.0,
										22.0
									],
									"text": "prepend name"
								}
							},
							{
								"box": {
									"id": "obj-651",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1030.0,
										213.0,
										80.0,
										22.0
									],
									"text": "prepend 7"
								}
							},
							{
								"box": {
									"id": "obj-652",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										1200.0,
										115.0,
										100.0,
										19.0
									],
									"text": "PRESET 8",
									"fontface": 1
								}
							},
							{
								"box": {
									"id": "obj-653",
									"maxclass": "textedit",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"parameter_enable": 0,
									"patching_rect": [
										1200.0,
										133.0,
										120.0,
										22.0
									],
									"text": "preset 8"
								}
							},
							{
								"box": {
									"id": "obj-654",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1200.0,
										160.0,
										65.0,
										22.0
									],
									"text": "store 8"
								}
							},
							{
								"box": {
									"id": "obj-655",
									"maxclass": "message",
									"numinlets": 2,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1270.0,
										160.0,
										70.0,
										22.0
									],
									"text": "recall 8"
								}
							},
							{
								"box": {
									"id": "obj-656",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1200.0,
										187.0,
										90.0,
										22.0
									],
									"text": "prepend name"
								}
							},
							{
								"box": {
									"id": "obj-657",
									"maxclass": "newobj",
									"numinlets": 1,
									"numoutlets": 1,
									"outlettype": [
										""
									],
									"patching_rect": [
										1200.0,
										213.0,
										80.0,
										22.0
									],
									"text": "prepend 8"
								}
							},
							{
								"box": {
									"id": "obj-658",
									"maxclass": "comment",
									"numinlets": 1,
									"numoutlets": 0,
									"patching_rect": [
										10.0,
										250.0,
										700.0,
										19.0
									],
									"text": "NOTE: browser recall via WebSocket not yet implemented (design ready \u2014 use pattrstorage recall msg from osc-hub when ready)"
								}
							}
						],
						"lines": [
							{
								"patchline": {
									"source": [
										"obj-607",
										0
									],
									"destination": [
										"obj-609",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-611",
										0
									],
									"destination": [
										"obj-614",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-614",
										0
									],
									"destination": [
										"obj-615",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-615",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-612",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-613",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-617",
										0
									],
									"destination": [
										"obj-620",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-620",
										0
									],
									"destination": [
										"obj-621",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-621",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-618",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-619",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-623",
										0
									],
									"destination": [
										"obj-626",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-626",
										0
									],
									"destination": [
										"obj-627",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-627",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-624",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-625",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-629",
										0
									],
									"destination": [
										"obj-632",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-632",
										0
									],
									"destination": [
										"obj-633",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-633",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-630",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-631",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-635",
										0
									],
									"destination": [
										"obj-638",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-638",
										0
									],
									"destination": [
										"obj-639",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-639",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-636",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-637",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-641",
										0
									],
									"destination": [
										"obj-644",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-644",
										0
									],
									"destination": [
										"obj-645",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-645",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-642",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-643",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-647",
										0
									],
									"destination": [
										"obj-650",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-650",
										0
									],
									"destination": [
										"obj-651",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-651",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-648",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-649",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-653",
										0
									],
									"destination": [
										"obj-656",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-656",
										0
									],
									"destination": [
										"obj-657",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-657",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-654",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							},
							{
								"patchline": {
									"source": [
										"obj-655",
										0
									],
									"destination": [
										"obj-607",
										0
									]
								}
							}
						]
					}
				}
			},
			{
				"box": {
					"id": "obj-663",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						10.0,
						220.0,
						600.0,
						19.0
					],
					"text": "\u2500\u2500\u2500 Subpatcher data flow (all via send/receive) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"
				}
			},
			{
				"box": {
					"id": "obj-664",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						10.0,
						240.0,
						520.0,
						19.0
					],
					"text": "sensor_inputs  \u2192 s sm_{A|B|C}_{angrate|accel|quat|dir|az}"
				}
			},
			{
				"box": {
					"id": "obj-665",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						10.0,
						258.0,
						750.0,
						19.0
					],
					"text": "derived_streams reads those, outputs \u2192 s sm_{A|B|C}_{angmag|accmag|jerk|still} + sm_{AB|AC|BC}_{pitch|roll|yaw}"
				}
			},
			{
				"box": {
					"id": "obj-666",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						10.0,
						276.0,
						650.0,
						19.0
					],
					"text": "mapping_engine reads any sm_* stream via dynamic r, sends to s osc-hub"
				}
			},
			{
				"box": {
					"id": "obj-667",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						10.0,
						294.0,
						700.0,
						19.0
					],
					"text": "p presets stores/recalls all pattr-enabled controls via pattrstorage mappingstorage"
				}
			}
		],
		"lines": []
	},
	"originid": "pat-sensor-mapping",
	"autosave": 0
}