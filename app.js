const express = require('express')
const app = express()
app.use(express.json())

const {open} = require('sqlite')
const sqlite3 = require('sqlite3')

const path = require('path')
let dbPath = path.join(__dirname, 'twitterClone.db')
let db = null

const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })

    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}

initializeDbAndServer()

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body

  const checkUser = `
    SELECT *
    FROM user
    WHERE username='${username}';
  `

  const dbUser = await db.get(checkUser)

  if (dbUser !== undefined) {
    response.status(400)
    response.send('User already exists')
  } else if (password.length < 6) {
    response.status(400)
    response.send('Password is too short')
  } else {
    const hashedPassword = await bcrypt.hash(password, 10)

    const insertUser = `
      INSERT INTO user(username,password,name,gender)
      VALUES(
        '${username}',
        '${hashedPassword}',
        '${name}',
        '${gender}'
      );
    `

    await db.run(insertUser)

    response.send('User created successfully')
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body

  const checkUserQuery = `
    SELECT *
    FROM user
    WHERE username='${username}';
  `

  const dbUser = await db.get(checkUserQuery)

  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)

    if (isPasswordMatched) {
      const payload = {
        userId: dbUser.user_id,
      }

      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')

      response.send({
        jwtToken,
      })
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

const authenticateToken = (request, response, next) => {
  let jwtToken

  const authHeader = request.headers['authorization']

  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }

  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.userId = payload.userId
        next()
      }
    })
  }
}

const checkTweetAccess = async (request, response, next) => {
  const {tweetId} = request.params
  const {userId} = request

  const query = `
    SELECT tweet.tweet_id
    FROM tweet
    INNER JOIN follower
      ON tweet.user_id = follower.following_user_id
    WHERE tweet.tweet_id=${tweetId}
      AND follower.follower_user_id=${userId};
  `

  const tweet = await db.get(query)

  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

const checkTweetOwner = async (request, response, next) => {
  const {tweetId} = request.params
  const {userId} = request

  const query = `
    SELECT *
    FROM tweet
    WHERE tweet_id=${tweetId}
      AND user_id=${userId};
  `

  const tweet = await db.get(query)

  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const {userId} = request

  const getFeedQuery = `
      SELECT
        user.username,
        tweet.tweet,
        tweet.date_time AS dateTime
      FROM follower
      INNER JOIN tweet
        ON follower.following_user_id = tweet.user_id
      INNER JOIN user
        ON user.user_id = tweet.user_id
      WHERE follower.follower_user_id = ${userId}
      ORDER BY tweet.date_time DESC
      LIMIT 4;
    `

  const tweets = await db.all(getFeedQuery)

  response.send(tweets)
})

app.get('/user/following/', authenticateToken, async (request, response) => {
  const {userId} = request

  const getFollowingQuery = `
      SELECT
        user.name
      FROM follower
      INNER JOIN user
        ON follower.following_user_id = user.user_id
      WHERE follower.follower_user_id = ${userId};
    `

  const following = await db.all(getFollowingQuery)

  response.send(following)
})

app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {userId} = request

  const getFollowersQuery = `
      SELECT
        user.name
      FROM follower
      INNER JOIN user
        ON follower.follower_user_id = user.user_id
      WHERE follower.following_user_id = ${userId};
    `

  const followers = await db.all(getFollowersQuery)

  response.send(followers)
})

app.get(
  '/tweets/:tweetId/',
  authenticateToken,
  checkTweetAccess,
  async (request, response) => {
    const {tweetId} = request.params

    const getTweetQuery = `
      SELECT
        tweet.tweet,
        COUNT(DISTINCT like.like_id) AS likes,
        COUNT(DISTINCT reply.reply_id) AS replies,
        tweet.date_time AS dateTime
      FROM tweet
      LEFT JOIN like
        ON tweet.tweet_id = like.tweet_id
      LEFT JOIN reply
        ON tweet.tweet_id = reply.tweet_id
      WHERE tweet.tweet_id = ${tweetId}
      GROUP BY tweet.tweet_id;
    `

    const tweetDetails = await db.get(getTweetQuery)

    response.send(tweetDetails)
  },
)

app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  checkTweetAccess,
  async (request, response) => {
    const {tweetId} = request.params

    const getLikesQuery = `
      SELECT
        user.username
      FROM like
      INNER JOIN user
        ON like.user_id = user.user_id
      WHERE like.tweet_id = ${tweetId};
    `

    const users = await db.all(getLikesQuery)

    response.send({
      likes: users.map(each => each.username),
    })
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  checkTweetAccess,
  async (request, response) => {
    const {tweetId} = request.params

    const getRepliesQuery = `
      SELECT
        user.name,
        reply.reply
      FROM reply
      INNER JOIN user
        ON reply.user_id = user.user_id
      WHERE reply.tweet_id = ${tweetId};
    `

    const replies = await db.all(getRepliesQuery)

    response.send({
      replies,
    })
  },
)

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {userId} = request

  const getUserTweetsQuery = `
      SELECT
        tweet.tweet,
        COUNT(DISTINCT like.like_id) AS likes,
        COUNT(DISTINCT reply.reply_id) AS replies,
        tweet.date_time AS dateTime
      FROM tweet
      LEFT JOIN like
        ON tweet.tweet_id = like.tweet_id
      LEFT JOIN reply
        ON tweet.tweet_id = reply.tweet_id
      WHERE tweet.user_id = ${userId}
      GROUP BY tweet.tweet_id;
    `

  const tweets = await db.all(getUserTweetsQuery)

  response.send(tweets)
})

app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {userId} = request
  const {tweet} = request.body

  const createTweetQuery = `
      INSERT INTO tweet(tweet, user_id, date_time)
      VALUES(
        '${tweet}',
        ${userId},
        DATETIME('now')
      );
    `

  await db.run(createTweetQuery)

  response.send('Created a Tweet')
})

app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  checkTweetOwner,
  async (request, response) => {
    const {tweetId} = request.params

    const deleteTweetQuery = `
      DELETE FROM tweet
      WHERE tweet_id = ${tweetId};
    `

    await db.run(deleteTweetQuery)

    response.send('Tweet Removed')
  },
)

module.exports = app
