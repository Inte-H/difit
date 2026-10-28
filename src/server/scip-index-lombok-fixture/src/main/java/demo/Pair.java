package demo;

import lombok.Getter;

@Getter
public class Pair {
    public int sum() {
        return left + getLeft();
    }

    private int left;
}
