import { HttpConfig, QBConfig, SmbConfig, SSHConfig } from '../types';

const defaultQBConfig: QBConfig = {
  qb_url: 'http://localhost:8080',
  username: 'admin',
  password: 'adminadmin',
  save_path: '/downloads',
  local_path: '',
  protocol: 'local',
};

const defaultSSHConfig: SSHConfig = {
  username: '',
  remotePath: '',
  privateKeyPath: '',
};

const defaultHTTPConfig: HttpConfig = {
  remotePath: '',
  username: '',
  password: '',
};

const defaultSMBConfig: SmbConfig = {
  remotePath: '',
};

export { defaultQBConfig, defaultSSHConfig, defaultSMBConfig, defaultHTTPConfig };
