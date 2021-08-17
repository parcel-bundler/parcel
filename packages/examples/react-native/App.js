import React from 'react';
import {Button, StyleSheet, Image, StatusBar, Text, View} from 'react-native';

export default function App() {
  // throw new Error('XYZ');
  return (
    <View style={styles.container}>
      <Text>Open up App.js to start working on your app!</Text>
      <Image
        style={{width: '100%'}}
        source={require('./assets/x.png')}
        resizeMode="contain"
      />
      <Button title="Click" onPress={() => console.log('Click')} />
      <StatusBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
