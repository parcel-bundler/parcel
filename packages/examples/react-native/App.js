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
      <Button
        title="Click"
        onPress={() => {
          // throw new Error('XYZ');
          console.log('Click');
        }}
      />
      {/* <Box /> */}
      <StatusBar />
    </View>
  );
}

// import Animated, {
//   useSharedValue,
//   useAnimatedStyle,
//   withSpring,
// } from 'react-native-reanimated';

// function Box() {
//   const offset = useSharedValue(0);

//   const animatedStyles = useAnimatedStyle(() => {
//     return {
//       transform: [{translateX: offset.value}],
//     };
//   });

//   return (
//     <>
//       <Animated.View style={[styles.box]} />
//       <Button
//         onPress={() => {
//           offset.value = withSpring(10 + Math.random() * 100);
//         }}
//         title="Move"
//       />
//     </>
//   );
// }

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    width: 50,
    height: 50,
    backgroundColor: 'blue',
  },
});
