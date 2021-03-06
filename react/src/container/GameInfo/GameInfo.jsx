import React from 'react'
import { connect } from 'react-redux'

import './GameInfo.scss'
import roomApi from '../../utils/api/room.js'
import userApi from '../../utils/api/user.js'
import ws from '../../utils/websocket/index.js'
import { roomSet, tabSet } from '../../utils/actions/index.js'

class GameInfo extends React.Component {

  constructor(props) {
    super(props);
  }

  componentWillMount() {
    ws.addOnmessage('createRoom', data => {
      location.href = '#/room/' + data.room.id
    })
  }

  componentWillUnmount() {
    ws.removeOnmessage('createRoom')
  }

  createRoom() {
    ws.createRoom(this.props.params.gameName)
  }

  render() {
    var gameName = this.props.params.gameName
    return (
      <div>
        <div className="LocationBar">
          <a href="#/gameList">游戏大厅</a><span> >> </span>
          <a className="CurrentLocation" href={"#/game/" + gameName}>{gameName}</a><span> | </span>
          <a href="#/roomList/">房间列表</a>
        </div>
        <div className='GameInfo'>
          <div className='window'>
            <img src={'/roms/' + gameName + '.jpg'} />
            <div>游戏名称：{gameName}</div>
            <div>游戏大小：100k</div>
            <div>Mapper类型：1</div>
          </div>
          <div className='gameButtonBox'>
            <button onClick={() => this.createRoom()}>创建游戏</button>
            {/* <button >加入游戏</button> */}
            {/* <button >添加收藏</button> */}
            <button onClick={() => { location.href = "#/gameList" }}>返回</button>
          </div>
        </div>
      </div>
    );
  }
}

export default GameInfo;