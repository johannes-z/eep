import { getChecksum } from '../../util/getChecksum';
import { isD2ControlValue } from './fan';

export interface D2ControlOptions {
  operationMode?: number;
  timerOperationMode?: boolean;
  co2Threshold?: number;
  humidityThreshold?: number;
  airQualityThreshold?: number;
}

function validateThreshold(value: number | undefined, name: string): number {
  const resolved = value ?? 127;
  if (!Number.isInteger(resolved) || ((resolved < 0 || resolved > 100) && resolved !== 127)) {
    throw new Error(`Invalid D2-50-00 ${name}: ${resolved}`);
  }
  return resolved;
}

export function changeState(
  senderBytes: number[],
  receiverBytes: number[],
  value: number,
  options: D2ControlOptions = {},
): Buffer {
  if (senderBytes.length !== 4 || receiverBytes.length !== 4) {
    throw new Error('D2-50-00 sender and receiver IDs must contain four bytes');
  }
  if (
    [...senderBytes, ...receiverBytes].some(
      (byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff,
    )
  ) {
    throw new Error('D2-50-00 identifiers must contain valid bytes');
  }
  if (!Number.isInteger(value) || !isD2ControlValue(value)) {
    throw new Error(`Unsupported D2-50-00 control value: ${value}`);
  }
  const operationMode = options.operationMode ?? 0;
  if (!Number.isInteger(operationMode) || operationMode < 0 || operationMode > 2) {
    throw new Error(`Invalid D2-50-00 operation mode control: ${operationMode}`);
  }
  if (options.timerOperationMode !== undefined && typeof options.timerOperationMode !== 'boolean') {
    throw new Error('Invalid D2-50-00 timer operation mode control');
  }
  const co2Threshold = validateThreshold(options.co2Threshold, 'CO2 threshold');
  const humidityThreshold = validateThreshold(options.humidityThreshold, 'humidity threshold');
  const airQualityThreshold = validateThreshold(
    options.airQualityThreshold,
    'air quality threshold',
  );

  const header = [0x00, 0x0c, 0x07, 0x01];
  const data = [
    0xd2,
    0x20 | value,
    operationMode << 6,
    (options.timerOperationMode ? 0x80 : 0) | co2Threshold,
    humidityThreshold,
    airQualityThreshold,
    0x00,
  ];
  const statusByte = 0x00;
  const subTelNum = 0x03;
  const rssi = 0xff;
  const securityLevel = 0x00;

  return Buffer.from([
    0x55,
    ...header,
    getChecksum(header),
    ...data,
    ...senderBytes,
    statusByte,
    subTelNum,
    ...receiverBytes,
    rssi,
    securityLevel,
    getChecksum([data, senderBytes, statusByte, subTelNum, receiverBytes, rssi, securityLevel]),
  ]);
}
