import React from 'react'
import { connect } from 'react-redux'

import './GameList.scss'
import gameApi from '../../api/game.js'
import Scroll from '../../components/Scroll.jsx'
import { gameSet, tabSet } from '../../actions/actions'

class GameList extends React.Component {

  constructor(props) {
    super(props)
    this.state = {
      gameList: []
    }
  }

  componentDidMount() {
    gameApi.getGameList().then(resp => {
      if (resp.error) {
        return
      }
      this.setState({ gameList: resp.data })
    })
  }

  chooseGame(game) {
    location.href = "#/game/" + game
    return false
  }

  render() {
    return (
      <div>
        <div className="LocationBar">
          <a className="CurrentLocation" href="#/gameList">游戏大厅</a><span> | </span>
          <a href="#/roomList/">房间列表</a>
        </div>
        <div className="GameList">
          {this.state.gameList.map(game => {
            return (
              <div className="GameListBlock" id='Block' key={game.name} onClick={this.chooseGame.bind(this, game.name)}>
                <img src={'/roms/' + game.name + '.jpg'} />
                <div className="BlockGameName">
                  {game.name}
                </div>
                <div className="BlockMask">
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }
}

export default GameList