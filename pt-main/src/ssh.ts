import { Client, ConnectConfig } from 'ssh2';
import { readFileSync } from 'fs';
import { webContents } from 'electron';
import { electronAPI } from './electronAPI';
import Struct from 'typed-struct';
import path from 'path';
import { DirItem } from './interface';
import util from 'util';
import createTorrent from 'create-torrent';

const Member = new Struct('Member').UInt8('ID1').UInt8('ID2').UInt8('CM').UInt8('FLG').UInt32LE('MTIME').UInt8('XFL').UInt8('OS').compile();
const Extra = new Struct('Extra').UInt8('SI1').UInt8('SI2').UInt16LE('LEN').Buffer('data').compile();

export class SSH {
  conn = new Client();
  ready = false;
  async createConnect() {
    if (this.ready) {
      console.log('already connected');
      return true;
    }

    const cfg = await electronAPI.store.get('sshConfig');
    const portExists = cfg.remotePath.split(':').length > 1;
    const connectCfg: ConnectConfig = {
      privateKey: readFileSync(cfg.privateKeyPath),
      username: cfg.username,
      host: cfg.remotePath.split(':')[0],
      port: portExists ? parseInt(cfg.remotePath.split(':')[1]) : 22,
    };

    return new Promise((resolve, reject) => {
      this.conn
        .on('ready', () => {
          console.log('Client :: ready');
          this.ready = true;
          resolve(true);
        })
        .on('error', (err) => {
          this.ready = false;
          reject(err);
        })
        .on('end', () => {
          this.ready = false;
        })
        .on('close', () => {
          this.ready = false;
        })
        .connect(connectCfg);
    });
  }

  async getFile(remotePath: string, localPath: string, infoHash: string) {
    if (!this.ready) await this.createConnect();
    const sftp = await util.promisify(this.conn.sftp).bind(this.conn)();
    sftp.fastGet(
      remotePath,
      localPath,
      {
        step: (total_transferred, chunk, total) => {
          console.log(total_transferred, chunk, total);
          //todo: on minimize, stop sending, on restore, send again;
          webContents.getFocusedWebContents().send('get_file_progress', {
            infoHash,
            progress: total_transferred / total,
          });
        },
      },
      (err) => {
        if (err) throw err;
      }
    );
  }

  async getList(p: string, type: 'd' | 'f') {
    if (!this.ready) await this.createConnect();
    const sftp = await util.promisify(this.conn.sftp).bind(this.conn)();
    const filePathList: string[] = type == 'f' ? [] : null;
    const rootDirItem: DirItem = type == 'd' ? ({ name: path.basename(p), children: {} } as DirItem) : null;
    const listPromise = await util.promisify(sftp.readdir).bind(sftp);
    return await readdir(p, rootDirItem?.children);
    //todo: 目录改成点开再readdir第一次打开更快？
    async function readdir(p: string, dir?: Record<string, DirItem>) {
      const list = await listPromise(p);
      for (const x of list) {
        if (x.longname[0] == 'd') {
          if (type == 'd') {
            dir[x.filename] = { name: x.filename, children: {} } as DirItem;
            await readdir(path.posix.join(p, x.filename), dir[x.filename].children);
          } else {
            await readdir(path.posix.join(p, x.filename), null);
          }
        } else if (type == 'f' && x.longname[0] == '-') {
          filePathList.push(path.posix.join(p, x.filename));
        }
      }
      if (type == 'f') return filePathList;
      else return rootDirItem;
    }
  }

  async ExtraField(path: string) {
    if (!this.ready) await this.createConnect();
    const sftp = await util.promisify(this.conn.sftp).bind(this.conn)();
    const SI1 = 65;
    const SI2 = 36;
    let position = 0;
    const handle = await util.promisify(sftp.open).bind(sftp)(path, 'r');
    const closePromise = util.promisify(sftp.close).bind(sftp);
    //自定义返回值为buffer，否则默认返回的是bytesRead
    sftp.read[util.promisify.custom] = (handle: Buffer, buffer: Buffer, offset: number, length: number, position: number) => {
      return new Promise((resolve, reject) => {
        sftp.read(handle, buffer, offset, length, position, (err: Error, bytesRead: number, buffer: Buffer) => {
          if (err) reject(err);
          resolve(buffer);
        });
      });
    };

    const sftpReadPromise = util.promisify(sftp.read).bind(sftp);
    async function read(length: number) {
      const buffer = await sftpReadPromise(handle, Buffer.alloc(length), 0, length, position);
      position += length;
      return buffer;
    }

    const headerBuffer = await read(Member.baseSize);
    const member = new Member(headerBuffer);
    if (member.ID1 !== 31 || member.ID2 !== 139) {
      throw new Error('invalid file signature:' + member.ID1 + ',' + member.ID2);
    }
    if (member.CM !== 8) {
      throw new Error('unknown compression method: ' + member.CM);
    }

    const FlagsMask = { FTEXT: 1, FHCRC: 2, FEXTRA: 4, FNAME: 8, FCOMMENT: 16 };

    if ((member.FLG & FlagsMask.FEXTRA) !== 0) {
      const lengthBuffer = await read(2);
      const length = lengthBuffer.readUInt16LE();
      const extraBuffer = await read(length);
      for (let offset = 0; offset < length; ) {
        const extra = new Extra(extraBuffer.subarray(offset));
        if (extra.SI1 == SI1 && extra.SI2 == SI2) {
          closePromise(handle);
          return extra.data.subarray(offset, offset + extra.LEN).toString();
        }
        offset += Extra.baseSize + extra.LEN;
      }
    }
    closePromise(handle);
  }

  async createTorrent(p: string, options: any) {
    if (!this.ready) await this.createConnect();
    const sftp = await util.promisify(this.conn.sftp).bind(this.conn)();
    const stat = await util.promisify(sftp.stat).bind(sftp)(p);
    const handle = await util.promisify(sftp.open).bind(sftp)(p, 'r');
    // options.size = stat.size;
    // const closePromise = util.promisify(sftp.close).bind(sftp)(handle);
    // return { handle, size: stat.size, closePromise };
    // createTorrent(handle, options, (err, torrent) => {
    //   if (err) throw err;
    //   util.promisify(sftp.close).bind(sftp)(handle);
    //   return torrent;
    // });

    // @ts-ignore
    const torrent = await util.promisify(createTorrent)(handle, options);
    return torrent;
  }
}
