import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Session, until } from '@voxel/agent-runtime';
import { PLAYER_NAME_TAKEN } from '@voxel/shared';
import { WorldRoom } from '../../src/world/room';

{
  process.env.DATABASE_URL = '';
  process.env.VOICE_PROVIDER = 'mock';
  const app = express();
  const http = createServer(app);
  const server = new Server({
    transport: new WebSocketTransport({ server: http }),
    greet: false,
    gracefullyShutdown: false,
  });
  server.define('world', WorldRoom);
  const sessions: Session[] = [];
  try {
    await server.listen(0, '127.0.0.1');
    const listing = await matchMaker.createRoom('world', {});
    const room = matchMaker.getLocalRoomById(listing.roomId) as WorldRoom;
    app.get('/world', (_req, res) => res.json({ roomId: listing.roomId }));
    const url = `ws://127.0.0.1:${(http.address() as { port: number }).port}`;
    const session = () => {
      const s = new Session(url);
      sessions.push(s);
      return s;
    };
    const a = session(),
      b = session();
    const results = await Promise.allSettled([
      a.join('Explorer', 'human'),
      b.join(' Explorer ', 'human'),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult)
        .reason.code,
      PLAYER_NAME_TAKEN,
    );
    assert.equal(room.state.players.size, 1);
    const winner = results[0].status === 'fulfilled' ? a : b;
    await assert.rejects(session().join('EXPLORER', 'ai-agent'), {
      code: PLAYER_NAME_TAKEN,
    });
    const originalId = winner.room.sessionId;
    const token = winner.room.reconnectionToken;
    winner.room.connection.close();
    await until(() => room.state.players.get(originalId)?.connected === false);
    await assert.rejects(session().join('Explorer'), {
      code: PLAYER_NAME_TAKEN,
    });
    winner.attach(await winner.client.reconnect(token));
    await until(() => room.state.players.get(originalId)?.connected === true);
    assert.equal(winner.room.sessionId, originalId);
    assert.equal(room.state.players.size, 1);
    await winner.close();
    await until(() => room.state.players.size === 0);
    await session().join(' Explorer ', 'human');
    assert.equal([...room.state.players.values()][0].name, 'Explorer');
    const long = '长'.repeat(24);
    await session().join(long + '甲', 'ai-agent');
    await assert.rejects(session().join(long + '乙', 'human'), {
      code: PLAYER_NAME_TAKEN,
    });
    assert.equal(room.state.players.size, 2);
  } finally {
    await Promise.all(sessions.map((s) => s.close()));
    await server.gracefullyShutdown(false);
  }
  console.log(
    'PASS: concurrent duplicate joins, case/whitespace/truncation collisions, human/Agent shared names, reconnect identity, release after exit.',
  );
}
