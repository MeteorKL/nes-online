package main

import (
	"encoding/json"
	"nes-online/koala"
	"net/http"

	mgo "gopkg.in/mgo.v2"
	"gopkg.in/mgo.v2/bson"
)

func apiKeyboard() {
	koala.Get("/api/getKeyboard", func(k *koala.Params, w http.ResponseWriter, r *http.Request) {
		user, _ := selectFromCollection("user", func(c *mgo.Collection) (map[string]interface{}, error) {
			user := make(map[string]interface{})
			err := c.Find(map[string]interface{}{
				"name": k.ParamGet["name"][0],
			}).One(&user)
			return user, err
		})
		koala.WriteJSON(w, user["keyboard"])
	})
	koala.Post("/api/setKeyboard", func(k *koala.Params, w http.ResponseWriter, r *http.Request) {
		keyboard := make(map[string]interface{})
		json.Unmarshal([]byte(k.ParamPost["keyboard"][0]), &keyboard)
		queryInCollection("user", func(c *mgo.Collection) (interface{}, error) {
			err := c.Update(map[string]interface{}{
				"name": k.ParamGet["name"][0],
			}, bson.M{
				"$set": bson.M{
					"keyboard": keyboard,
				},
			})
			return nil, err
		})
		koala.WriteJSON(w, map[string]interface{}{
			"state": true,
			"msg":   "修改成功",
		})
	})
	koala.Post("/api/register", register)
}
