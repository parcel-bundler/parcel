module Main exposing (main)

import Browser
import Html exposing (Html, button, div, text)
import Html.Attributes exposing (class)
import Html.Events exposing (onClick)


type alias Model =
    { count : Int }


initialModel : Model
initialModel =
    { count = 0 }


type Msg
    = Increment
    | Decrement
    | Peter


update : Msg -> Model -> Model
update msg model =
    case msg of
        Increment ->
            { model | count = model.count + 1 }

        Decrement ->
            { model | count = model.count - 1 }

getMsgName msg =
    case msg of
        Increment -> "Assi"
        Decrement -> "Peter"


view : Model -> Html Msg
view model =
    div []
        [ div []
            [ button [ onClick Increment ] [ text "+1" ]
            , div [] [ text <| String.fromInt model.count ]
            , button [ onClick Decrement ] [ text "-1" ]
            ]
        , Html.node "x-im-not-registered" [] []
        ]


main : Program () Model Msg
main =
    Browser.sandbox
        { init = initialModel
        , view = view
        , update = update
        }
